/**
 * One employee's payslip for one month, shared by the payroll run and by every
 * attendance change made after a draft payroll exists.
 *
 *   attendanceStatsFor  - the attendance numbers a payslip is built from
 *   buildSlip           - computes and saves one employee's slip on a run
 *   refreshPayrollAfterAttendanceChange
 *                       - keeps a DRAFT month in step with attendance edits:
 *                         the employee's slip and the run totals are recalculated
 *                         at once (manual adjustments kept). A RELEASED month is
 *                         never rewritten silently; the caller is told instead.
 */
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Holiday = require('../models/Holiday');
const ShiftAssignment = require('../models/ShiftAssignment');
const PayrollRule = require('../models/PayrollRule');
const PayrollRun = require('../models/PayrollRun');
const SalarySlip = require('../models/SalarySlip');
const { monthRange, eachDate, startOfDay, endOfDay, dateKey, holidayDateKey, holidayAppliesTo, companyToday } = require('../utils/date');
const { calculateSalary, roundMoney } = require('../utils/salary');
const { getActiveSalaryMastersMap } = require('./salaryMasterService');

async function attendanceStatsFor(employee, month, tenantId) {
  const { from, to } = monthRange(month);
  const today = companyToday();
  const allDates = eachDate(from, to);
  // v26: holidayDateKey was used here without being imported, so payroll for ANY
  // month containing a holiday crashed with "holidayDateKey is not defined".
  // The query is widened by a day because legacy rows were saved at IST midnight
  // (18:30Z the previous UTC day) and a holiday on the 1st fell outside the range.
  const holidays = await Holiday.find({ tenantId, date: { $gte: new Date(from.getTime() - 86400000), $lte: new Date(to.getTime() + 86400000) } });
  const monthPrefix = month.slice(0, 7);
  // An OFFICE-only holiday is a working day at the plant (and vice versa).
  const holidayKeys = new Set(holidays
    .filter((h) => !h.optional && holidayAppliesTo(h, employee.workLocation))
    .map((h) => holidayDateKey(h))
    .filter((key) => key.startsWith(monthPrefix)));
  const assignments = await ShiftAssignment.find({
    tenantId,
    employeeId: employee._id,
    fromDate: { $lte: to },
    $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: from } }]
  }).populate('shiftId').sort('fromDate createdAt');
  const joinDate = employee.dateOfJoining ? startOfDay(employee.dateOfJoining) : null;

  function shiftForDay(day) {
    return [...assignments].reverse().find((assignment) => {
      const assignmentFrom = assignment.fromDate ? startOfDay(assignment.fromDate) : from;
      const assignmentTo = assignment.toDate ? endOfDay(assignment.toDate) : to;
      return day >= assignmentFrom && day <= assignmentTo;
    })?.shiftId;
  }

  const workingDates = allDates.filter((d) => {
    const day = startOfDay(d);
    const key = dateKey(day);
    if (joinDate && day < joinDate) return false;
    // WAGES rule: payable working-day denominator is calendar days less Sundays.
    // Holidays and shift templates do not silently reduce that statutory wage denominator.
    if (employee.employeeCategory === 'WAGES') return day.getDay() !== 0;
    if (holidayKeys.has(key)) return false;
    const shift = shiftForDay(day);
    const weeklyOffDays = Array.isArray(shift?.weeklyOffDays) ? shift.weeklyOffDays : [0];
    return !weeklyOffDays.includes(day.getDay());
  });

  const attendance = await Attendance.find({
    tenantId,
    employeeId: employee._id,
    date: { $gte: from, $lte: to }
  });
  const byDate = new Map(attendance.map((a) => [dateKey(a.date), a]));

  let totalLopDays = 0;
  let presentDays = 0;
  let halfDays = 0;
  let wfhDays = 0;
  let leaveDays = 0;
  let absentDays = 0;
  let missingAbsentDays = 0;
  let lateCount = 0;
  let earlyLeaveCount = 0;
  let scheduledFutureDays = 0;
  let reviewDays = 0;

  for (const date of workingDates) {
    const day = startOfDay(date);
    const key = dateKey(day);
    const record = byDate.get(key);

    // Future duty dates are planned workdays, not absences. For the current month,
    // today is also treated as pending unless attendance is already completed or a
    // protected paid status has been recorded.
    if (day > today) {
      scheduledFutureDays += 1;
      continue;
    }
    if (day.getTime() === today.getTime() && (!record || (record.checkIn && !record.checkOut))) {
      scheduledFutureDays += 1;
      continue;
    }

    if (!record) {
      absentDays += 1;
      missingAbsentDays += 1;
      totalLopDays += 1;
      continue;
    }

    lateCount += Number(record.lateMinutes || 0) > 0 ? 1 : 0;
    earlyLeaveCount += Number(record.earlyLeaveMinutes || 0) > 0 ? 1 : 0;
    // A missing out time waits for HR / admin. It is paid until they decide.
    if (record.needsReview) reviewDays += 1;

    const explicitLop = Math.max(0, Number(record.lopDays || 0));
    // When HR / admin has set the LOP for the day (removed it, or set it by hand)
    // that figure is final. Absent and half days used to be floored at 1 and 0.5
    // here, so "remove LOP" on an absent day never reached the payslip.
    const lopIsSetByHr = Boolean(record.lopOverride?.enabled);
    if (record.status === 'ABSENT') {
      absentDays += 1;
      totalLopDays += lopIsSetByHr ? explicitLop : Math.max(1, explicitLop);
    } else if (record.status === 'HALF_DAY') {
      halfDays += 1;
      totalLopDays += lopIsSetByHr ? explicitLop : Math.max(0.5, explicitLop);
    } else {
      if (record.status === 'PRESENT') presentDays += 1;
      if (record.status === 'WFH') wfhDays += 1;
      if (record.status === 'LEAVE') leaveDays += record.dayPart === 'FULL' ? 1 : 0.5;
      totalLopDays += explicitLop;
    }
  }

  const workingDays = workingDates.length;
  const attendanceLopDays = Math.min(Math.max(totalLopDays, 0), workingDays);
  const payableDays = Math.max(0, workingDays - attendanceLopDays);

  return {
    workingDays,
    payableDays,
    presentDays,
    halfDays,
    wfhDays,
    leaveDays,
    attendanceLopDays,
    lateCount,
    earlyLeaveCount,
    absentDays,
    missingAbsentDays,
    reviewDays,
    scheduledFutureDays
  };
}

/** Computes one employee's slip and saves it on the run. Manual adjustments are re-applied. */
async function buildSlip({ tenantId, run, employee, month, rule, salaryMaster, adjustment }) {
  const stats = await attendanceStatsFor(employee, month, tenantId);
  const calc = calculateSalary({ employee, attendanceStats: stats, rule, salaryMaster });
  const earnings = { basic: calc.basic, hra: calc.hra, conveyance: calc.conveyance, specialAllowance: calc.specialAllowance, otherEarnings: calc.otherEarnings, gross: calc.gross, proratedGross: calc.proratedGross, custom: calc.customEarnings || {} };
  const earningAdj = Number(adjustment?.earningsAdjustment ?? adjustment?.earning ?? 0);
  const deductionAdj = Number(adjustment?.deductionAdjustment ?? adjustment?.deduction ?? 0);
  const netPay = roundMoney(calc.netPay + earningAdj - deductionAdj);
  const slip = await SalarySlip.findOneAndUpdate(
    { tenantId, employeeId: employee._id, month },
    { tenantId, payrollRunId: run._id, employeeId: employee._id, month, attendanceStats: stats, earnings, deductions: calc.deductions, lop: calc.lop, salaryMasterId: calc.salaryMasterId, salaryMasterEffectiveMonth: calc.salaryMasterEffectiveMonth, netPay, generatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { slip, calc, netPay, stats };
}

/** Run totals from the slips on it, so a recalculated slip shows up in the totals at once. */
async function recalculateRunSummary(run) {
  const slips = await SalarySlip.find({ tenantId: run.tenantId, payrollRunId: run._id }).select('earnings.proratedGross deductions.total netPay').lean();
  const sum = (pick) => roundMoney(slips.reduce((total, slip) => total + Number(pick(slip) || 0), 0));
  run.summary = {
    employeeCount: slips.length,
    grossTotal: sum((s) => s.earnings?.proratedGross),
    deductionTotal: sum((s) => s.deductions?.total),
    netTotal: sum((s) => s.netPay)
  };
  await run.save();
  return run.summary;
}

function monthsOf(dates = []) {
  return Array.from(new Set(dates
    .filter(Boolean)
    .map((d) => (/^\d{4}-\d{2}$/.test(String(d)) ? String(d) : dateKey(startOfDay(d)).slice(0, 7)))))
    .sort();
}

/**
 * After attendance changes: bring that month's payroll up to date.
 * Returns one entry per month:
 *   { month, state: 'UPDATED' | 'RELEASED' | 'NOT_GENERATED', ... }
 * With a single employee, UPDATED also carries the before / after LOP and net pay.
 * Never throws: attendance is already saved, so a payroll problem is reported, not raised.
 */
async function refreshPayrollAfterAttendanceChange({ tenantId, employeeIds = [], dates = [], months = [] }) {
  const ids = Array.from(new Set(employeeIds.filter(Boolean).map(String)));
  const wanted = Array.from(new Set([...monthsOf(dates), ...months])).sort();
  const results = [];
  for (const month of wanted) {
    try {
      const run = await PayrollRun.findOne({ tenantId, month });
      if (!run) { results.push({ month, state: 'NOT_GENERATED' }); continue; }
      if (run.status === 'FINALIZED') { results.push({ month, state: 'RELEASED' }); continue; }
      const rule = await PayrollRule.findOne({ tenantId, active: true });
      if (!rule || !ids.length) { results.push({ month, state: 'NOT_GENERATED' }); continue; }

      const { to: monthEnd } = monthRange(month);
      // The same people a payroll run includes: not offboarded, joined by month end.
      const employees = (await Employee.find({ tenantId, _id: { $in: ids }, status: { $ne: 'OFFBOARDED' } }))
        .filter((e) => !e.dateOfJoining || new Date(e.dateOfJoining) <= monthEnd);
      if (!employees.length) { results.push({ month, state: 'UPDATED', employees: 0, summary: run.summary }); continue; }
      const [masters, previousSlips] = await Promise.all([
        getActiveSalaryMastersMap({ tenantId, employeeIds: employees.map((e) => e._id), month }),
        SalarySlip.find({ tenantId, month, employeeId: { $in: employees.map((e) => e._id) } }).select('employeeId manualAdjustments netPay attendanceStats.attendanceLopDays').lean()
      ]);
      const previousBy = new Map(previousSlips.map((slip) => [String(slip.employeeId), slip]));
      const changes = [];
      for (const employee of employees) {
        const before = previousBy.get(String(employee._id));
        const { netPay, stats } = await buildSlip({
          tenantId,
          run,
          employee,
          month,
          rule,
          salaryMaster: masters.get(String(employee._id)),
          adjustment: before?.manualAdjustments || null
        });
        changes.push({
          employeeId: String(employee._id),
          lopDaysBefore: before ? Number(before.attendanceStats?.attendanceLopDays || 0) : null,
          lopDaysAfter: Number(stats.attendanceLopDays || 0),
          netPayBefore: before ? Number(before.netPay || 0) : null,
          netPayAfter: netPay
        });
      }
      const summary = await recalculateRunSummary(run);
      const entry = { month, state: 'UPDATED', employees: changes.length, summary };
      if (changes.length === 1) Object.assign(entry, changes[0]);
      results.push(entry);
    } catch (error) {
      console.warn(`[payroll] could not refresh ${month} after an attendance change: ${error.message}`);
      results.push({ month, state: 'FAILED', error: error.message });
    }
  }
  return results;
}

/** One line for the person who made the change. Pay figures only for people with payroll access. */
function payrollNote(results = [], { showPay = false } = {}) {
  const label = (month) => {
    const [y, m] = String(month).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  };
  const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const parts = [];
  for (const r of results) {
    if (r.state === 'UPDATED' && !showPay) {
      parts.push(`${label(r.month)} payroll draft updated to match.`);
    } else if (r.state === 'UPDATED') {
      const unchanged = r.netPayBefore !== null && r.netPayBefore !== undefined && r.netPayBefore === r.netPayAfter && r.lopDaysBefore === r.lopDaysAfter;
      if (unchanged) {
        parts.push(`${label(r.month)} payroll draft checked: pay unchanged (LOP ${r.lopDaysAfter} day(s)).`);
      } else if (r.netPayAfter !== undefined && r.netPayBefore !== null && r.netPayBefore !== undefined) {
        parts.push(`${label(r.month)} payroll draft updated: LOP ${r.lopDaysBefore} → ${r.lopDaysAfter} day(s), net pay ${money(r.netPayBefore)} → ${money(r.netPayAfter)}.`);
      } else if (r.netPayAfter !== undefined) {
        parts.push(`${label(r.month)} payroll draft updated: LOP ${r.lopDaysAfter} day(s), net pay ${money(r.netPayAfter)}.`);
      } else {
        parts.push(`${label(r.month)} payroll draft updated.`);
      }
    } else if (r.state === 'RELEASED') {
      parts.push(`${label(r.month)} payroll is already released, so released slips were not changed. Super Admin can regenerate that month from Payroll to apply this.`);
    } else if (r.state === 'FAILED') {
      parts.push(`Attendance is saved, but the ${label(r.month)} payroll draft could not be refreshed (${r.error}). Run payroll again for that month.`);
    }
  }
  return parts.join(' ');
}

function canSeePay(user) {
  const { hasAbility } = require('../middleware/auth');
  return ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role) || hasAbility(user, 'PAYROLL', 'READ');
}

/**
 * For request handlers that change attendance: refresh the payroll draft and
 * return what to tell the user. Pay amounts are removed for people who cannot
 * see payroll (a manager correcting their team's attendance, say).
 */
async function syncPayrollAfterChange(req, { employeeIds = [], dates = [], months = [] }) {
  const results = await refreshPayrollAfterAttendanceChange({ tenantId: req.tenantId, employeeIds, dates, months });
  const showPay = canSeePay(req.user);
  const payroll = results.map((r) => (showPay ? r : { month: r.month, state: r.state }));
  return { payroll, payrollNote: payrollNote(results, { showPay }) };
}

module.exports = { attendanceStatsFor, buildSlip, recalculateRunSummary, refreshPayrollAfterAttendanceChange, syncPayrollAfterChange, payrollNote, monthsOf, canSeePay };
