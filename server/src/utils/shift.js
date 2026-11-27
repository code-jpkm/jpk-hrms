const DEFAULT_TIMEZONE_OFFSET_MINUTES = Number(process.env.HRMS_TIMEZONE_OFFSET_MINUTES || process.env.TIMEZONE_OFFSET_MINUTES || 330);

function parseTimeToMinutes(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return (Number(h || 0) * 60) + Number(m || 0);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60 * 1000);
}

function localDateParts(date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  const shifted = new Date(new Date(date).getTime() + Number(timezoneOffsetMinutes || 0) * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate()
  };
}

// Attendance/assignment dates are stored as semantic calendar dates. Convert the
// semantic date + local clock minutes into a real UTC instant. This prevents a
// 10:00-18:00 India shift from being interpreted as 10:00-18:00 UTC on cloud servers.
function dateAtMinutes(date, minutes, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  const { year, month, day } = localDateParts(date, timezoneOffsetMinutes);
  const utcMidnight = Date.UTC(year, month, day, 0, 0, 0, 0);
  return new Date(utcMidnight + Number(minutes || 0) * 60000 - Number(timezoneOffsetMinutes || 0) * 60000);
}

// Return a stable UTC-midnight date key for the local HRMS calendar day.
function calendarDayStart(date, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  const { year, month, day } = localDateParts(date, timezoneOffsetMinutes);
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * ROOT CAUSE of the "Early leave 321 min" bug on a 10:00-18:00 shift where the
 * employee actually punched out at 18:09.
 *
 * 321 minutes is exactly 18:00 minus 12:39. 12:39 UTC IS 18:09 IST. So the punch
 * was stored correctly in UTC but the shift window was built with an offset of
 * ZERO, i.e. the window was treated as 18:00 UTC. The callers used
 * `Number(policy.timezoneOffsetMinutes ?? 330)` — and `??` does NOT fall back on
 * 0. Any policy row that ended up with 0 (an empty form field posted as "",
 * which Mongoose casts to 0, or a doc created before the field existed) silently
 * shifts every shift window by 5h30m and manufactures phantom early-leave.
 *
 * This resolver treats 0 as "not configured" unless the tenant explicitly opts
 * into UTC via timezoneOffsetExplicit, so a blank form can never corrupt payroll.
 */
function resolveTimezoneOffset(source) {
  if (typeof source === 'number') {
    return source === 0 ? DEFAULT_TIMEZONE_OFFSET_MINUTES : source;
  }
  const raw = source?.timezoneOffsetMinutes;
  if (raw === null || raw === undefined || raw === '') return DEFAULT_TIMEZONE_OFFSET_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TIMEZONE_OFFSET_MINUTES;
  if (n === 0 && source?.timezoneOffsetExplicit !== true) return DEFAULT_TIMEZONE_OFFSET_MINUTES;
  return n;
}

function computeShiftWindow(shift, shiftDate, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES) {
  const startMinutes = parseTimeToMinutes(shift?.startTime || '09:30');
  const endMinutes = parseTimeToMinutes(shift?.endTime || '18:30');
  const start = dateAtMinutes(shiftDate, startMinutes, timezoneOffsetMinutes);
  let duration = Number(shift?.durationMinutes || 0);
  if (!duration) {
    duration = endMinutes - startMinutes;
    if (duration <= 0 || shift?.crossesMidnight) duration += 24 * 60;
  }
  const end = addMinutes(start, duration);
  const allowedStart = addMinutes(start, -Number(shift?.allowedEarlyInMinutes || 0));
  const allowedEnd = addMinutes(end, Number(shift?.allowedLateOutMinutes || 0));
  return { start, end, allowedStart, allowedEnd, durationMinutes: duration, timezoneOffsetMinutes: Number(timezoneOffsetMinutes || 0) };
}

/** 0 = Sunday … 6 = Saturday for a calendar day, as startOfDay / dateKey / calendarDayStart give it. */
function weekdayOfDay(day) {
  return new Date(day).getDay();
}

/** A row limited to some weekdays (Mon–Fri, Saturdays…) applies only on those days; a row without a list applies every day. */
function assignmentAppliesOnWeekday(assignment, day) {
  const days = assignment?.weekdays;
  if (!Array.isArray(days) || !days.length) return true;
  return days.map(Number).includes(weekdayOfDay(day));
}

/**
 * The shift row that decides one day: of the rows covering the day, the
 * latest-starting one (newest on a tie) whose weekdays include it. Every shift
 * lookup uses this rule (directly, or on rows it already loaded).
 */
async function latestAssignmentOn({ tenantId, employeeId, day, populate = true, lean = false }) {
  const ShiftAssignment = require('../models/ShiftAssignment');
  let query = ShiftAssignment.find({
    tenantId,
    employeeId,
    fromDate: { $lte: day },
    $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: day } }]
  }).sort('-fromDate -createdAt');
  if (populate) query = query.populate('shiftId');
  if (lean) query = query.lean();
  const rows = await query;
  return rows.find((row) => assignmentAppliesOnWeekday(row, day)) || null;
}

/** From rows sorted oldest first (fromDate, createdAt): the row that decides `day` (see latestAssignmentOn). */
function pickAssignmentForDay(rowsOldestFirst, day, { from = new Date(0), to = new Date(8640000000000000) } = {}) {
  const dayStart = startOfDay(day);
  for (let i = rowsOldestFirst.length - 1; i >= 0; i -= 1) {
    const row = rowsOldestFirst[i];
    const rowFrom = row.fromDate ? startOfDay(row.fromDate) : from;
    const rowTo = row.toDate ? new Date(new Date(row.toDate).setHours(23, 59, 59, 999)) : to;
    if (dayStart >= rowFrom && dayStart <= rowTo && assignmentAppliesOnWeekday(row, dayStart)) return row;
  }
  return null;
}

async function findActiveShiftAssignment({ tenantId, employeeId, at, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES }) {
  const date = calendarDayStart(at || new Date(), timezoneOffsetMinutes);
  return latestAssignmentOn({ tenantId, employeeId, day: date });
}

async function resolveAttendanceDateForPunch({ tenantId, employeeId, timestamp, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES }) {
  const ts = new Date(timestamp);
  const today = calendarDayStart(ts, timezoneOffsetMinutes);
  const candidates = [today, new Date(today.getTime() - 24 * 60 * 60 * 1000)];
  for (const candidate of candidates) {
    const assignment = await latestAssignmentOn({ tenantId, employeeId, day: candidate });
    const shift = assignment?.shiftId;
    if (!shift) continue;
    const window = computeShiftWindow(shift, candidate, timezoneOffsetMinutes);
    if (ts >= window.allowedStart && ts <= window.allowedEnd) {
      return { attendanceDate: candidate, shift, window };
    }
  }
  return { attendanceDate: today, shift: null, window: null };
}

function minutesBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));
}

function statusFromWorkedMinutes(shift, checkIn, checkOut, defaultStatus = 'PRESENT', options = {}) {
  if (!checkIn) return 'ABSENT';
  if (!checkOut) return defaultStatus;

  const inTime = new Date(checkIn);
  const outTime = new Date(checkOut);
  if (Number.isNaN(inTime.getTime()) || Number.isNaN(outTime.getTime()) || outTime <= inTime) return 'ABSENT';

  const worked = minutesBetween(inTime, outTime);
  const startMinutes = parseTimeToMinutes(shift?.startTime || '00:00');
  const endMinutes = parseTimeToMinutes(shift?.endTime || '00:00');
  let scheduledMinutes = Number(shift?.durationMinutes || 0);
  if (!scheduledMinutes && shift?.startTime && shift?.endTime) {
    scheduledMinutes = endMinutes - startMinutes;
    if (scheduledMinutes <= 0 || shift?.crossesMidnight) scheduledMinutes += 24 * 60;
  }

  // A historical shift edit can change 09:30-18:30 to 10:00-18:00 while an old
  // fullDayMinutes value (for example 540) remains on the Shift record. Never make
  // an employee HALF_DAY for completing the entire newly assigned duty window.
  const configuredFullDay = Number(shift?.fullDayMinutes || 0);
  const fullDayMinutes = scheduledMinutes > 0
    ? (configuredFullDay > 0 ? Math.min(configuredFullDay, scheduledMinutes) : scheduledMinutes)
    : configuredFullDay;
  const configuredHalfDay = Number(shift?.halfDayMinutes || 0);
  const defaultHalfDay = fullDayMinutes > 0 ? Math.floor(fullDayMinutes / 2) : 0;
  const halfDayMinutes = configuredHalfDay > 0 && (!fullDayMinutes || configuredHalfDay < fullDayMinutes)
    ? configuredHalfDay
    : defaultHalfDay;

  if (worked <= 0) return 'ABSENT';

  // Do not turn an otherwise valid punch pair into HALF_DAY just because the
  // employee worked a few minutes less than fullDayMinutes. Late/early policy is
  // evaluated separately (including the monthly 3-exception rule). Only a truly
  // short worked duration below the configured half-day threshold is classified
  // as HALF_DAY here; missing/invalid punch pairs are handled as ABSENT elsewhere.
  if (halfDayMinutes > 0 && worked < halfDayMinutes) return options.belowHalfDayStatus === 'ABSENT' ? 'ABSENT' : 'HALF_DAY';
  return defaultStatus;
}

/**
 * Late / early-leave measured against the shift window, with a sanity net.
 *
 * If a misconfigured timezone ever shifts the window again, the raw arithmetic
 * would report an "early leave" larger than the shift itself. Physically
 * impossible, so we surface it as a flagged anomaly (0 penalty) instead of
 * quietly charging the employee half a day.
 */
const MINUTE_MS = 60000;

/**
 * The grace that applies: the larger of the company policy's late grace and
 * the shift's own grace, so neither setting is ever silently ignored.
 */
function effectiveGraceMinutes(policy, shift) {
  return Math.max(0, Number(policy?.lateGraceMinutes || 0), Number(shift?.graceMinutes || 0));
}

/**
 * Whole minutes late, or 0 while still inside the grace. With a 10:00 start and
 * 15 minutes grace, 10:14:59 is on time and 10:15:00 is the first late second.
 * Seconds never round up into a late minute.
 */
function lateMinutesAfterGrace(start, checkIn, graceMinutes = 0) {
  if (!start || !checkIn) return 0;
  const lateMs = new Date(checkIn).getTime() - new Date(start).getTime();
  if (!(lateMs > 0)) return 0;
  if (lateMs < Math.max(0, Number(graceMinutes || 0)) * MINUTE_MS) return 0;
  return Math.floor(lateMs / MINUTE_MS);
}

/** Whole minutes left early, or 0 within the tolerance (leaving 17:45:00 with 15 min tolerance is fine). */
function earlyMinutesAfterTolerance(end, checkOut, toleranceMinutes = 0) {
  if (!end || !checkOut) return 0;
  const earlyMs = new Date(end).getTime() - new Date(checkOut).getTime();
  if (!(earlyMs > 0)) return 0;
  if (earlyMs <= Math.max(0, Number(toleranceMinutes || 0)) * MINUTE_MS) return 0;
  return Math.floor(earlyMs / MINUTE_MS);
}

function measureAgainstWindow({ window, checkIn, checkOut, graceMinutes = 0, earlyToleranceMinutes = 0 }) {
  const duration = Number(window?.durationMinutes || 0);
  const rawLate = Math.max(0, minutesBetween(window.start, checkIn));
  const rawEarly = Math.max(0, minutesBetween(checkOut, window.end));
  const worked = minutesBetween(checkIn, checkOut);
  const anomalies = [];

  // Grace and early tolerance decide whether a minute counts at all.
  let lateMinutes = lateMinutesAfterGrace(window.start, checkIn, graceMinutes);
  let earlyLeaveMinutes = earlyMinutesAfterTolerance(window.end, checkOut, earlyToleranceMinutes);
  const withinGrace = rawLate > 0 && lateMinutes === 0;

  if (duration > 0 && rawEarly > duration) {
    anomalies.push(`Early leave of ${rawEarly}m exceeds the ${duration}m shift; treating as 0 and flagging for review`);
    earlyLeaveMinutes = 0;
  }
  if (duration > 0 && rawLate > duration) {
    anomalies.push(`Late-in of ${rawLate}m exceeds the ${duration}m shift; treating as 0 and flagging for review`);
    lateMinutes = 0;
  }
  if (duration > 0 && worked > 0 && earlyLeaveMinutes > 0 && worked + rawLate >= duration) {
    // Worked the full window once lateness is accounted for: there is no early leave.
    anomalies.push(`Worked ${worked}m covers the full ${duration}m window; early-leave of ${rawEarly}m discarded as a clock-offset artefact`);
    earlyLeaveMinutes = 0;
  }

  return { lateMinutes, earlyLeaveMinutes, workedMinutes: worked, rawLate, rawEarly, withinGrace, anomalies };
}

module.exports = {
  effectiveGraceMinutes,
  lateMinutesAfterGrace,
  earlyMinutesAfterTolerance,
  DEFAULT_TIMEZONE_OFFSET_MINUTES,
  resolveTimezoneOffset,
  measureAgainstWindow,
  parseTimeToMinutes,
  computeShiftWindow,
  resolveAttendanceDateForPunch,
  findActiveShiftAssignment,
  weekdayOfDay,
  assignmentAppliesOnWeekday,
  latestAssignmentOn,
  pickAssignmentForDay,
  statusFromWorkedMinutes,
  minutesBetween,
  startOfDay,
  calendarDayStart,
  dateAtMinutes
};
