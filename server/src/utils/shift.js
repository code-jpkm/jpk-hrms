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

async function findActiveShiftAssignment({ tenantId, employeeId, at, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES }) {
  const ShiftAssignment = require('../models/ShiftAssignment');
  const date = calendarDayStart(at || new Date(), timezoneOffsetMinutes);
  return ShiftAssignment.findOne({
    tenantId,
    employeeId,
    fromDate: { $lte: date },
    $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: date } }]
  }).populate('shiftId').sort('-fromDate');
}

async function resolveAttendanceDateForPunch({ tenantId, employeeId, timestamp, timezoneOffsetMinutes = DEFAULT_TIMEZONE_OFFSET_MINUTES }) {
  const ShiftAssignment = require('../models/ShiftAssignment');
  const ts = new Date(timestamp);
  const today = calendarDayStart(ts, timezoneOffsetMinutes);
  const candidates = [today, new Date(today.getTime() - 24 * 60 * 60 * 1000)];
  for (const candidate of candidates) {
    const assignment = await ShiftAssignment.findOne({
      tenantId,
      employeeId,
      fromDate: { $lte: candidate },
      $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: candidate } }]
    }).populate('shiftId').sort('-fromDate');
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
function measureAgainstWindow({ window, checkIn, checkOut }) {
  const duration = Number(window?.durationMinutes || 0);
  const rawLate = Math.max(0, minutesBetween(window.start, checkIn));
  const rawEarly = Math.max(0, minutesBetween(checkOut, window.end));
  const worked = minutesBetween(checkIn, checkOut);
  const anomalies = [];

  let lateMinutes = rawLate;
  let earlyLeaveMinutes = rawEarly;

  if (duration > 0 && rawEarly > duration) {
    anomalies.push(`Early leave of ${rawEarly}m exceeds the ${duration}m shift; treating as 0 and flagging for review`);
    earlyLeaveMinutes = 0;
  }
  if (duration > 0 && rawLate > duration) {
    anomalies.push(`Late-in of ${rawLate}m exceeds the ${duration}m shift; treating as 0 and flagging for review`);
    lateMinutes = 0;
  }
  if (duration > 0 && worked > 0 && rawEarly > 0 && worked + rawLate >= duration) {
    // Worked the full window once lateness is accounted for: there is no early leave.
    anomalies.push(`Worked ${worked}m covers the full ${duration}m window; early-leave of ${rawEarly}m discarded as a clock-offset artefact`);
    earlyLeaveMinutes = 0;
  }

  return { lateMinutes, earlyLeaveMinutes, workedMinutes: worked, rawLate, rawEarly, anomalies };
}

module.exports = {
  DEFAULT_TIMEZONE_OFFSET_MINUTES,
  resolveTimezoneOffset,
  measureAgainstWindow,
  parseTimeToMinutes,
  computeShiftWindow,
  resolveAttendanceDateForPunch,
  statusFromWorkedMinutes,
  minutesBetween,
  startOfDay,
  calendarDayStart,
  dateAtMinutes
};
