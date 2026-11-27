/**
 * Writing shift rows (ShiftAssignment) the same way everywhere: the Shifts page,
 * the attendance calendar, the AI command page, the HR chat and weekly patterns.
 *
 * A row covers fromDate … toDate (no toDate = from then on) and, optionally,
 * only some weekdays (0 = Sunday … 6 = Saturday). On any day the latest-starting
 * row that covers it and includes its weekday decides the shift (newest on a tie);
 * see utils/shift.js latestAssignmentOn.
 */
const ShiftAssignment = require('../models/ShiftAssignment');
const Attendance = require('../models/Attendance');
const { rebuildAttendanceForEmployees } = require('./attendanceReprocessService');
const { evaluateAttendanceRecord } = require('./attendanceRulesService');
const { syncPayrollAfterChange } = require('./payrollSlipService');
const { startOfDay, endOfDay, dateKey, companyToday } = require('../utils/date');

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Sorted, unique 0–6; undefined for "every day" (none given, or all seven). */
function normalizeWeekdays(list) {
  const days = Array.from(new Set((Array.isArray(list) ? list : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
  return days.length && days.length < 7 ? days : undefined;
}

/** [1,2,3,4,5] → "Mon–Fri", [6] → "Sat", [1,3,5] → "Mon, Wed, Fri", [0] (long) → "Sunday". */
function weekdaysLabel(list, { long = false } = {}) {
  const days = normalizeWeekdays(list);
  if (!days) return long ? 'every day' : 'Every day';
  const names = long ? DAY_LONG : DAY_SHORT;
  // Monday-first runs, so Mon–Sat and Sun read naturally.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const picked = order.filter((d) => days.includes(d));
  const runs = [];
  for (const d of picked) {
    const last = runs[runs.length - 1];
    if (last && order.indexOf(d) === order.indexOf(last[last.length - 1]) + 1) last.push(d);
    else runs.push([d]);
  }
  return runs.map((run) => (run.length >= 3 ? `${names[run[0]]}–${names[run[run.length - 1]]}` : run.map((d) => names[d]).join(', '))).join(', ');
}

/**
 * One row for one person. A row for every day replaces rows for the same dates
 * that were limited to some weekdays (it is the newer instruction for all of them).
 */
async function upsertShiftAssignment({ tenantId, employeeId, shiftId, fromDate, toDate = null, weekdays, assignedBy }) {
  const days = normalizeWeekdays(weekdays);
  const from = fromDate ? new Date(fromDate) : null;
  const to = toDate ? new Date(toDate) : null;
  const same = { tenantId, employeeId, fromDate: from, toDate: to };
  if (!days) await ShiftAssignment.deleteMany({ ...same, 'weekdays.0': { $exists: true } });
  const filter = days ? { ...same, weekdays: days } : { ...same, 'weekdays.0': { $exists: false } };
  const update = { tenantId, employeeId, shiftId, fromDate: from, toDate: to, assignedBy };
  if (days) update.weekdays = days;
  else update.$unset = { weekdays: 1 };
  return ShiftAssignment.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
}

/**
 * After shift rows change for days that have already happened: punches are
 * grouped by the right shift again, the stored days re-evaluated, and the
 * payroll draft of those months follows (released months are left alone).
 */
async function recalculateAfterShiftChange(req, { employeeIds, fromDate, toDate, reason, force = false }) {
  const todayKey = dateKey(companyToday());
  const fromKey = String(fromDate).slice(0, 10);
  const toKey = toDate ? String(toDate).slice(0, 10) : todayKey;
  const endKey = toKey < todayKey ? toKey : todayKey;
  if (!employeeIds.length || fromKey > endKey) return { reprocess: null, reevaluated: 0, payroll: [] };
  const reprocess = await rebuildAttendanceForEmployees({ tenantId: req.tenantId, employeeIds, fromDate: fromKey, toDate: endKey, force: Boolean(force), reason, changedBy: req.user._id });
  const storedRows = await Attendance.find({ tenantId: req.tenantId, employeeId: { $in: employeeIds }, date: { $gte: startOfDay(fromKey), $lte: endOfDay(endKey) } }).sort('employeeId date');
  let reevaluated = 0;
  for (const row of storedRows) {
    if (row.lopOverride?.enabled && !force) continue;
    await evaluateAttendanceRecord(row);
    reevaluated += 1;
  }
  let payroll = [];
  if (reevaluated) {
    const months = [];
    for (let d = new Date(`${fromKey.slice(0, 7)}-01T00:00:00.000Z`); dateKey(d).slice(0, 7) <= endKey.slice(0, 7) && months.length < 12; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(dateKey(d).slice(0, 7));
    payroll = (await syncPayrollAfterChange(req, { employeeIds, months })).payroll;
  }
  return { reprocess, reevaluated, payroll };
}

module.exports = { normalizeWeekdays, weekdaysLabel, upsertShiftAssignment, recalculateAfterShiftChange, DAY_SHORT, DAY_LONG };
