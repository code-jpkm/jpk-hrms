const Attendance = require('../models/Attendance');
const ShiftAssignment = require('../models/ShiftAssignment');
const AttendancePolicy = require('../models/AttendancePolicy');
const { computeShiftWindow, resolveTimezoneOffset } = require('../utils/shift');
const { startOfDay, companyHour } = require('../utils/date');

const DEFAULT_GRACE_MINUTES = 180;

/**
 * THE BUG THIS FIXES
 * ------------------
 * `getMobileAttendanceContext` looked back a flat 36 hours for any attendance
 * row with a check-in and no check-out, and offered it for check-out. So:
 *
 *   Mon 10:00  employee checks in
 *   Mon 18:00  shift ends, employee forgets to punch out
 *   Tue 09:55  employee opens the app to check IN
 *              -> the 36h window finds Monday's open row
 *              -> the button says "Check out"
 *              -> Tuesday morning is written as MONDAY's check-out
 *
 * Monday becomes a 24-hour shift and Tuesday has no attendance at all. That is
 * exactly the "I forgot my out time and it recorded today as the out time"
 * report.
 *
 * A duty day now stays open only until its shift ends plus a grace period
 * (default 3 hours, `policy.autoCloseOpenPunchAfterMinutes`). After that the day
 * is closed with **checkOut left NULL** — the system never invents a punch time —
 * and flagged `missingCheckOut` so HR can regularize it and payroll can treat it
 * correctly.
 */

async function shiftWindowFor({ tenantId, employeeId, date, offset }) {
  const assignment = await ShiftAssignment.findOne({
    tenantId,
    employeeId,
    fromDate: { $lte: date },
    $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: date } }]
  }).populate('shiftId').sort('-fromDate');
  if (!assignment?.shiftId) return null;
  return computeShiftWindow(assignment.shiftId, date, offset);
}

/**
 * The moment an open duty day stops accepting a check-out.
 * Falls back to end-of-day + grace when no shift is assigned, so a record can
 * never stay open forever.
 */
async function closeDeadlineFor({ tenantId, employeeId, date, policy, offset }) {
  const grace = Number(policy?.autoCloseOpenPunchAfterMinutes ?? DEFAULT_GRACE_MINUTES);
  const window = await shiftWindowFor({ tenantId, employeeId, date, offset });
  const base = window?.end || new Date(startOfDay(date).getTime() + 24 * 60 * 60 * 1000);
  return new Date(new Date(base).getTime() + grace * 60000);
}

async function isStillOpenForCheckout({ tenantId, employeeId, attendance, policy, now = new Date() }) {
  if (!attendance?.checkIn || attendance.checkOut) return false;
  if (attendance.autoClosed) return false;
  const offset = resolveTimezoneOffset(policy);
  const deadline = await closeDeadlineFor({ tenantId, employeeId, date: attendance.date, policy, offset });
  return now <= deadline;
}

/**
 * Close every open punch whose deadline has passed.
 * Scoped to one employee when `employeeId` is supplied (called lazily before a
 * punch), or tenant-wide from the scheduler.
 */
const policyCache = require('./policyCache');
const { freeze, thaw } = require('./memoCache');

/** The active policy (else any), kept for a minute like getPolicy; cleared when a policy is saved. */
async function activePolicy(tenantId) {
  const key = `active:${tenantId}`;
  const cached = policyCache.get(key);
  if (cached) return thaw(AttendancePolicy, cached);
  const policy = await AttendancePolicy.findOne({ tenantId, active: true })
    || await AttendancePolicy.findOne({ tenantId });
  if (policy) policyCache.set(key, freeze(policy));
  return policy;
}

async function autoCloseStalePunches({ tenantId, employeeId = null, now = new Date(), lookbackHours = 72 }) {
  const policy = await activePolicy(tenantId);
  const offset = resolveTimezoneOffset(policy);

  const query = {
    tenantId,
    checkIn: { $exists: true, $ne: null },
    $or: [{ checkOut: null }, { checkOut: { $exists: false } }],
    autoClosed: { $ne: true },
    date: { $gte: startOfDay(new Date(now.getTime() - lookbackHours * 60 * 60 * 1000)) }
  };
  if (employeeId) query.employeeId = employeeId;

  const open = await Attendance.find(query);
  const closed = [];

  for (const record of open) {
    const deadline = await closeDeadlineFor({
      tenantId, employeeId: record.employeeId, date: record.date, policy, offset
    });
    if (now <= deadline) continue;

    record.autoClosed = true;
    record.autoClosedAt = now;
    record.missingCheckOut = true;
    record.checkOut = null; // never fabricate a time
    const note = 'No check-out recorded; duty day closed automatically. Regularize to set the correct out time.';
    record.deductionReason = record.deductionReason ? `${record.deductionReason} · ${note}` : note;
    await record.save();
    closed.push(record._id);
  }

  return { closed: closed.length, ids: closed };
}

/** Friendly end-of-punch copy, varied by the hour rather than a flat string. */
function punchMessage({ mode, now = new Date(), employeeName = '' }) {
  const first = String(employeeName || '').split(' ')[0];
  const who = first ? `, ${first}` : '';
  // Company clock, not the server's: on a UTC host a 3 pm IST check-in said "Good morning".
  const hour = companyHour(now);
  if (mode === 'in') {
    if (hour < 11) return `Good morning${who} — you're checked in. Have a good shift.`;
    if (hour < 16) return `Checked in${who}. Have a good shift.`;
    return `Checked in${who}. Have a good shift tonight.`;
  }
  if (hour < 16) return `Attendance captured${who}. See you tomorrow, on time.`;
  if (hour < 21) return `Attendance captured${who}. Have a good evening — see you tomorrow.`;
  return `Attendance captured${who}. Have a great night, see you tomorrow.`;
}

module.exports = {
  autoCloseStalePunches,
  isStillOpenForCheckout,
  closeDeadlineFor,
  punchMessage,
  DEFAULT_GRACE_MINUTES
};
