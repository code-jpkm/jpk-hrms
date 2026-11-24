/**
 * GET /api/dashboard/home — everything the Home screen needs in one request,
 * filtered by the caller's own scope:
 *   me:      today's attendance + shift, leave balances, latest released payslip
 *   team:    who is away / late today, pending approvals (only with a team scope)
 *   company: upcoming holidays, celebrations, latest notices
 */
const asyncHandler = require('../utils/asyncHandler');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const Regularization = require('../models/Regularization');
const Holiday = require('../models/Holiday');
const SalarySlip = require('../models/SalarySlip');
const Notice = require('../models/Notice');
const ShiftAssignment = require('../models/ShiftAssignment');
const Shift = require('../models/Shift');
const PayrollRule = require('../models/PayrollRule');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { isFingerprintOnly } = require('../services/attendanceModeService');
const { payrollLockOn, isMonthOpen } = require('../services/payrollLockService');
const { semanticDateKey, holidayDateKey } = require('../utils/date');
const { hasAbility } = require('../middleware/auth');

const IST = 330 * 60 * 1000;
const todayKey = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
function windowFor(key) {
  const utc = new Date(`${key}T00:00:00.000Z`);
  return { $gte: new Date(utc.getTime() - IST), $lte: new Date(utc.getTime() + 86399999) };
}
const fullName = (e) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim();

function daysUntil(key, fromKey) {
  return Math.round((new Date(`${key}T00:00:00Z`) - new Date(`${fromKey}T00:00:00Z`)) / 86400000);
}

function nextOccurrence(value, fromKey) {
  const k = semanticDateKey(value);
  if (!k) return null;
  const year = Number(fromKey.slice(0, 4));
  let candidate = `${year}${k.slice(4)}`;
  if (k.slice(5) === '02-29' && new Date(`${year}-02-29T00:00:00Z`).getUTCMonth() !== 1) candidate = `${year}-02-28`;
  if (candidate < fromKey) candidate = `${year + 1}${k.slice(4)}`;
  return { key: candidate, days: daysUntil(candidate, fromKey), originYear: Number(k.slice(0, 4)) };
}

exports.home = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  const key = todayKey();
  const window = windowFor(key);
  const me = req.employee;

  const [attendanceScope, leaveScope] = await Promise.all([
    getScopedEmployeeIds({ user: req.user, employee: me, resource: 'ATTENDANCE' }),
    getScopedEmployeeIds({ user: req.user, employee: me, resource: 'LEAVE' })
  ]);
  const teamView = attendanceScope.length > 1;

  // ---------- me ----------
  let mine = null;
  if (me) {
    const [att, balances, slips, myPendingLeave, myPendingReg, assignment, payRule, onlyFingerprint] = await Promise.all([
      Attendance.findOne({ tenantId, employeeId: me._id, date: window }).select('status checkIn checkOut lateMinutes earlyLeaveMinutes source missingCheckOut').lean(),
      LeaveBalance.find({ tenantId, employeeId: me._id }).lean(),
      SalarySlip.find({ tenantId, employeeId: me._id }).populate('payrollRunId', 'status').sort('-month').limit(6).lean(),
      LeaveRequest.countDocuments({ tenantId, employeeId: me._id, status: 'PENDING' }),
      Regularization.countDocuments({ tenantId, employeeId: me._id, status: 'PENDING' }),
      // Same choice as attendance: the latest-starting assignment covering today,
      // including open-ended ones (no end date), which the old query skipped.
      ShiftAssignment.findOne({ tenantId, employeeId: me._id, fromDate: { $lte: window.$lte }, $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: window.$gte } }] }).sort('-fromDate -createdAt').lean(),
      PayrollRule.findOne({ tenantId, active: true }).select('lockUntilMonthEnds').lean(),
      isFingerprintOnly(me, tenantId)
    ]);
    let shift = null;
    if (assignment?.shiftId) shift = await Shift.findOne({ _id: assignment.shiftId, tenantId }).select('name startTime endTime').lean();
    if (!shift) shift = await Shift.findOne({ tenantId, active: true }).sort('createdAt').select('name startTime endTime').lean();
    // A released payslip, and never one for a month that has not ended while payroll is locked.
    const slip = slips.find((s) => s.payrollRunId?.status === 'FINALIZED' && (!payrollLockOn(payRule) || isMonthOpen(s.month)));
    mine = {
      attendance: att,
      shift,
      balances: balances.map((b) => ({
        leaveType: b.leaveType,
        available: Math.round((Number(b.accrued || 0) + Number(b.manualAdjusted || 0) + Number(b.carriedForward || 0) - Number(b.used || 0)) * 10) / 10,
        total: Math.round((Number(b.accrued || 0) + Number(b.manualAdjusted || 0) + Number(b.carriedForward || 0)) * 10) / 10,
        used: Number(b.used || 0)
      })),
      latestSlip: slip ? { _id: slip._id, month: slip.month, netPay: slip.netPay, earnings: slip.earnings, deductions: slip.deductions } : null,
      pending: { leave: myPendingLeave, regularization: myPendingReg },
      canMobileAttendance: !onlyFingerprint && Boolean(me.canUseGeofencing || me.canUseAnywhereAttendance)
    };
  }

  // ---------- team ----------
  let team = null;
  if (teamView) {
    const others = attendanceScope.filter((id) => !me || String(id) !== String(me._id));
    const [onLeave, rows, pendingLeaves, pendingRegs, people] = await Promise.all([
      LeaveRequest.find({ tenantId, employeeId: { $in: leaveScope }, status: 'APPROVED', fromDate: { $lte: window.$lte }, toDate: { $gte: window.$gte } }).populate('employeeId', 'firstName lastName employeeCode department').lean(),
      Attendance.find({ tenantId, employeeId: { $in: others }, date: window }).select('employeeId status checkIn lateMinutes').lean(),
      LeaveRequest.countDocuments({ tenantId, employeeId: { $in: leaveScope }, status: 'PENDING' }),
      Regularization.countDocuments({ tenantId, employeeId: { $in: attendanceScope }, status: 'PENDING' }),
      Employee.find({ tenantId, _id: { $in: others }, status: { $ne: 'OFFBOARDED' } }).select('firstName lastName employeeCode department').lean()
    ]);
    const byId = new Map(people.map((p) => [String(p._id), p]));
    const checkedIn = rows.filter((r) => r.checkIn).length;
    team = {
      size: people.length,
      checkedIn,
      away: onLeave.filter((l) => l.employeeId).map((l) => ({
        employeeId: l.employeeId._id,
        name: fullName(l.employeeId),
        department: l.employeeId.department,
        type: l.requestType === 'WFH' ? 'WFH' : l.leaveType,
        until: semanticDateKey(l.toDate)
      })).slice(0, 12),
      late: rows.filter((r) => Number(r.lateMinutes) > 0).sort((a, b) => b.lateMinutes - a.lateMinutes).slice(0, 6).map((r) => ({ employeeId: r.employeeId, name: fullName(byId.get(String(r.employeeId))), minutes: r.lateMinutes })),
      pending: { leave: pendingLeaves, regularization: pendingRegs },
      isApprover: ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'].includes(req.user.role) || hasAbility(req.user, 'LEAVE', 'APPROVE')
    };
  }

  // ---------- company ----------
  const [holidays, people, notices] = await Promise.all([
    Holiday.find({ tenantId, date: { $gte: new Date(Date.now() - 2 * 86400000) } }).sort('date').limit(20).lean(),
    // Celebrations are company-wide (name and department only), like a notice board.
    Employee.find({ tenantId, status: { $ne: 'OFFBOARDED' } }).select('firstName lastName department dateOfBirth dateOfJoining profilePhotoUrl').lean(),
    Notice.find({
      tenantId,
      ...(['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role) ? {} : { $or: [
        { employeeIds: me?._id || null },
        { employeeIds: { $size: 0 }, audienceLocations: { $in: me?.workLocation === 'BOTH' ? ['OFFICE', 'FACTORY'] : [me?.workLocation || 'OFFICE'] } },
        { employeeIds: { $size: 0 }, audienceLocations: { $size: 0 } }
      ] }),
      $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gte: new Date() } }] }]
    }).select('title body pinned createdAt publishedBy fileName').populate('publishedBy', 'name').sort('-pinned -createdAt').limit(5).lean()
  ]);

  const upcomingHolidays = holidays
    .map((h) => ({ _id: h._id, name: h.name, date: holidayDateKey(h), optional: h.optional, location: h.location }))
    .filter((h) => h.date >= key)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)
    .map((h) => ({ ...h, daysAway: daysUntil(h.date, key) }));

  const celebrations = [];
  for (const p of people) {
    if (p.dateOfBirth) {
      const n = nextOccurrence(p.dateOfBirth, key);
      if (n && n.days <= 14) celebrations.push({ type: 'BIRTHDAY', employeeId: p._id, name: fullName(p), department: p.department, photo: p.profilePhotoUrl, date: n.key, daysAway: n.days, isMe: me && String(me._id) === String(p._id) });
    }
    if (p.dateOfJoining) {
      const n = nextOccurrence(p.dateOfJoining, key);
      const years = n ? Number(n.key.slice(0, 4)) - n.originYear : 0;
      if (n && n.days <= 14 && years > 0) celebrations.push({ type: 'ANNIVERSARY', employeeId: p._id, name: fullName(p), department: p.department, photo: p.profilePhotoUrl, date: n.key, daysAway: n.days, years, isMe: me && String(me._id) === String(p._id) });
    }
  }
  celebrations.sort((a, b) => a.daysAway - b.daysAway || a.name.localeCompare(b.name));

  res.json({
    date: key,
    me: mine,
    team,
    holidays: upcomingHolidays,
    celebrations: celebrations.slice(0, 12),
    notices: notices.map((n) => ({ _id: n._id, title: n.title, body: String(n.body || '').slice(0, 260), pinned: n.pinned, createdAt: n.createdAt, by: n.publishedBy?.name, hasAttachment: Boolean(n.fileName) }))
  });
});
