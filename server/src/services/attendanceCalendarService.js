/**
 * One employee's month, day by day, exactly as the attendance calendar shows it:
 * resolved status (present / absent / leave / holiday / week-off / live), punches,
 * worked minutes, late / early minutes, LOP and flags, plus a month summary.
 * Used by the calendar API and by the Gemini attendance review, so the AI sees
 * the same numbers the employee sees.
 */
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const ShiftAssignment = require('../models/ShiftAssignment');
const Shift = require('../models/Shift');
const Regularization = require('../models/Regularization');
const ApiError = require('../utils/apiError');
const { startOfDay, endOfDay, monthRange, eachDate, dateKey, holidayDateKey, holidayAppliesTo, companyToday } = require('../utils/date');
const { computeShiftWindow, minutesBetween, resolveTimezoneOffset, effectiveGraceMinutes, lateMinutesAfterGrace } = require('../utils/shift');
const { evaluateMonth, getPolicy } = require('./attendanceRulesService');
const { isStillOpenForCheckout } = require('./attendanceAutoCloseService');

const IST_FALLBACK = 330;
const PUNCH_SOURCES = ['BIOMETRIC', 'MOBILE_GEOFENCE', 'ANYWHERE'];
const LETTERS = { PRESENT: 'P', ABSENT: 'A', HALF_DAY: 'HD', WFH: 'WFH', HOLIDAY: 'H', WEEK_OFF: 'WO', UPCOMING: '—', NOT_MARKED: '·', IN_PROGRESS: 'IN', REVIEW: '?' };

function istMinutesOfDay(value, offset = IST_FALLBACK) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(((d.getTime() / 60000) + offset) % 1440 + 1440) % 1440;
}

function hhmm(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '';
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Assignment rows sorted by fromDate; the last one covering the day wins (same rule as the evaluator). */
function shiftOn(assignments, dayStart, defaultShift, from, to) {
  const assignment = [...assignments].reverse().find((a) => {
    const assignmentFrom = a.fromDate ? startOfDay(a.fromDate) : from;
    const assignmentTo = a.toDate ? endOfDay(a.toDate) : to;
    return dayStart >= assignmentFrom && dayStart <= assignmentTo;
  });
  return assignment?.shiftId || defaultShift || null;
}

async function buildCalendar({ tenantId, employeeId, month: requestedMonth, selfHeal = true }) {
  const today = companyToday();
  const month = /^\d{4}-\d{2}$/.test(String(requestedMonth || '')) ? requestedMonth : dateKey(today).slice(0, 7);
  const { from, to } = monthRange(month);
  const employee = await Employee.findOne({ _id: employeeId, tenantId: tenantId }).select('employeeCode firstName lastName department designation workLocation dateOfJoining profilePhotoUrl');
  if (!employee) throw new ApiError(404, 'Employee not found');
  const policy = await getPolicy(tenantId);
  const offset = resolveTimezoneOffset(policy);

  // The calendar shows exactly what payroll will apply: the month is evaluated
  // with the same batched rules a payroll run uses (one set of lookups for the
  // whole month, and only days whose result changed are written). A punch that is
  // still open for check-out is left alone until the employee punches out.
  const yesterday = new Date(today.getTime() - 86400000);
  const stillOpen = (row) => Boolean(row.checkIn && !row.checkOut && !row.autoClosed && startOfDay(row.date) >= yesterday);
  const attendance = selfHeal
    ? await evaluateMonth({ tenantId, employeeIds: [employeeId], month, filter: (row) => !stillOpen(row), returnAll: true })
    : await Attendance.find({ tenantId: tenantId, employeeId, date: { $gte: from, $lte: to } }).sort('date');

  // Widened by a day so legacy IST-midnight holiday rows on the 1st are found.
  const [holidays, assignments, defaultShift, leaves, pendingRegularizations] = await Promise.all([
    Holiday.find({ tenantId: tenantId, date: { $gte: new Date(from.getTime() - 86400000), $lte: new Date(to.getTime() + 86400000) } }),
    ShiftAssignment.find({
      tenantId: tenantId,
      employeeId,
      fromDate: { $lte: to },
      $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: from } }]
    }).populate('shiftId').sort('fromDate createdAt'),
    Shift.findOne({ tenantId: tenantId, active: true }).sort('createdAt'),
    LeaveRequest.find({ tenantId: tenantId, employeeId, status: { $in: ['APPROVED', 'PENDING'] }, fromDate: { $lte: to }, toDate: { $gte: from } }).select('requestType leaveType status fromDate toDate dayPart days reason').lean(),
    Regularization.find({ tenantId: tenantId, employeeId, status: 'PENDING', date: { $gte: from, $lte: to } }).select('date requestType requestedCheckIn requestedCheckOut requestedMinutes reason').lean()
  ]);
  const byDate = new Map(attendance.map((a) => [dateKey(a.date), a]));
  const holidayByDate = new Map(holidays
    .filter((h) => holidayAppliesTo(h, employee.workLocation))
    .map((h) => [holidayDateKey(h), h])
    .filter(([key]) => key.startsWith(month)));
  const pendingByDate = new Map(pendingRegularizations.map((r) => [dateKey(r.date), r]));
  const leaveOn = (dayStart, wanted) => leaves.find((l) => l.status === wanted && startOfDay(l.fromDate) <= dayStart && startOfDay(l.toDate) >= dayStart);
  const now = new Date();
  const joinDay = employee.dateOfJoining ? startOfDay(employee.dateOfJoining) : null;

  const days = [];
  for (const date of eachDate(from, to)) {
    const dayStart = startOfDay(date);
    const key = dateKey(dayStart);
    const record = byDate.get(key);
    const holiday = holidayByDate.get(key);
    const shift = shiftOn(assignments, dayStart, defaultShift, from, to);
    const isToday = dayStart.getTime() === today.getTime();
    const isFuture = dayStart > today;
    const beforeJoining = Boolean(joinDay && dayStart < joinDay);

    let status = record?.status;
    // A night shift's open punch from yesterday is still "in progress" until its checkout deadline.
    if (record?.checkIn && !record?.checkOut && !record?.autoClosed && dayStart >= new Date(today.getTime() - 86400000)) {
      if (isToday || await isStillOpenForCheckout({ tenantId: tenantId, employeeId, attendance: record, policy, now })) status = 'IN_PROGRESS';
    }
    // Someone who actually worked on a holiday must still show their attendance.
    const workedOnHoliday = Boolean(holiday && record?.checkIn);
    if (!status && holiday) status = 'HOLIDAY';
    const weeklyOffDays = Array.isArray(shift?.weeklyOffDays) && shift.weeklyOffDays.length ? shift.weeklyOffDays : [0];
    if (!status && weeklyOffDays.includes(dayStart.getUTCDay())) status = 'WEEK_OFF';
    if (!status && beforeJoining) status = 'NOT_JOINED';
    if (!status && isFuture) status = 'UPCOMING';
    if (!status && isToday) status = 'NOT_MARKED';
    if (!status) status = 'ABSENT';

    const approvedLeave = status === 'LEAVE' || status === 'WFH' ? leaveOn(dayStart, 'APPROVED') : null;
    const pendingLeave = leaveOn(dayStart, 'PENDING');
    // Out (or in) time missing on a closed day: shown in yellow until HR / admin decides.
    if (record?.needsReview && status !== 'IN_PROGRESS') status = 'REVIEW';
    let liveLateMinutes = Number(record?.lateMinutes || 0);
    let progressLabel = '';
    if (status === 'IN_PROGRESS' && record?.checkIn && shift) {
      const liveWindow = computeShiftWindow(shift, dayStart, offset);
      // Same rule as the day's final result: inside the grace is on time.
      liveLateMinutes = lateMinutesAfterGrace(liveWindow.start, record.checkIn, effectiveGraceMinutes(policy, shift));
      progressLabel = liveLateMinutes > 0 ? `Late in · ${liveLateMinutes}m` : 'On time';
    }
    const workedMinutes = record?.checkIn && record?.checkOut ? minutesBetween(record.checkIn, record.checkOut) : 0;
    const missingPunch = Boolean(record && !isToday && PUNCH_SOURCES.includes(record.source) && (record.checkIn || record.checkOut) && !(record.checkIn && record.checkOut) && status !== 'IN_PROGRESS');
    const pendingRequest = pendingByDate.get(key);
    const lopDays = ['NOT_JOINED', 'UPCOMING', 'NOT_MARKED', 'IN_PROGRESS', 'HOLIDAY', 'WEEK_OFF'].includes(status) && !record
      ? 0
      : (record?.lopDays ?? (status === 'ABSENT' ? 1 : status === 'HALF_DAY' ? 0.5 : 0));
    const letter = workedOnHoliday ? 'H+' : status === 'LEAVE' ? (record?.dayPart === 'FULL' ? 'L' : 'HL') : status === 'NOT_JOINED' ? '' : (LETTERS[status] || status[0]);

    days.push({
      date: key,
      day: dayStart.getUTCDate(),
      weekday: dayStart.getUTCDay(),
      status,
      letter,
      dayPart: record?.dayPart || 'FULL',
      holidayName: holiday?.name,
      isHoliday: Boolean(holiday),
      workedOnHoliday,
      holidayWorkMinutes: workedOnHoliday ? workedMinutes : 0,
      shiftId: shift?._id ? String(shift._id) : '',
      shiftName: shift?.name || record?.meta?.shiftName || '',
      shiftStart: shift?.startTime || '',
      shiftEnd: shift?.endTime || '',
      shiftGraceMinutes: shift ? effectiveGraceMinutes(policy, shift) : 0,
      shiftMinutes: shift ? computeShiftWindow(shift, dayStart, offset).durationMinutes : 0,
      checkIn: record?.checkIn,
      checkOut: record?.checkOut,
      workedMinutes,
      lateMinutes: status === 'IN_PROGRESS' ? liveLateMinutes : (record?.lateMinutes || 0),
      // Arrived after the shift start but inside the grace: on time.
      withinGrace: Boolean(record?.graceUsed) && !Number(record?.lateMinutes || 0),
      progressLabel,
      earlyLeaveMinutes: record?.earlyLeaveMinutes || 0,
      // An absent day usually has NO attendance row at all; its LOP is derived from
      // the resolved status and only disappears once approved leave covers it.
      lopDays,
      lopSource: record?.lopDays !== undefined && record?.lopDays !== null ? 'CALCULATED' : (status === 'ABSENT' ? 'ABSENT_NO_RECORD' : 'NONE'),
      lopOverridden: Boolean(record?.lopOverride?.enabled),
      lopOverrideReason: record?.lopOverride?.enabled ? (record.lopOverride.reason || '') : '',
      // HR / admin pinned this day (marked it, removed its LOP, or overrode it); "undo" puts the calculation back.
      hrChanged: Boolean(record && (record.lopOverride?.enabled || record.source === 'OVERRIDE')),
      canUndoHrChange: Boolean(record && record.status !== 'LEAVE' && (record.lopOverride?.enabled || record.meta?.beforeHr)),
      needsReview: Boolean(record?.needsReview),
      missingSide: record?.needsReview ? (record.checkIn ? 'OUT' : 'IN') : '',
      deductionReason: record?.deductionReason || '',
      source: record?.source || '',
      siteName: record?.location?.siteName || record?.meta?.mobile?.checkInLocation?.siteName || '',
      missingPunch,
      autoClosed: Boolean(record?.autoClosed),
      leaveType: approvedLeave ? (approvedLeave.requestType === 'WFH' ? 'WFH' : approvedLeave.leaveType) : '',
      pendingLeave: pendingLeave ? (pendingLeave.requestType === 'WFH' ? 'WFH' : pendingLeave.leaveType) : '',
      pendingLeaveRequest: pendingLeave ? {
        id: String(pendingLeave._id),
        type: pendingLeave.requestType === 'WFH' ? 'WFH' : pendingLeave.leaveType,
        fromDate: dateKey(startOfDay(pendingLeave.fromDate)),
        toDate: dateKey(startOfDay(pendingLeave.toDate)),
        days: pendingLeave.days,
        dayPart: pendingLeave.dayPart || 'FULL',
        reason: pendingLeave.reason || ''
      } : null,
      pendingRegularization: pendingRequest?.requestType || '',
      pendingRegularizationRequest: pendingRequest ? {
        id: String(pendingRequest._id),
        type: pendingRequest.requestType,
        checkIn: pendingRequest.requestedCheckIn || null,
        checkOut: pendingRequest.requestedCheckOut || null,
        minutes: pendingRequest.requestedMinutes || 0,
        reason: pendingRequest.reason || ''
      } : null,
      isFuture,
      isToday
    });
  }

  // Month summary for the KPI strip (only days up to today count).
  const elapsed = days.filter((d) => !d.isFuture && d.status !== 'NOT_JOINED');
  const workdays = elapsed.filter((d) => !['HOLIDAY', 'WEEK_OFF'].includes(d.status) || d.workedOnHoliday);
  const count = (pred) => elapsed.filter(pred).length;
  const withIn = elapsed.filter((d) => d.checkIn && ['PRESENT', 'WFH', 'HALF_DAY', 'IN_PROGRESS', 'REVIEW'].includes(d.status));
  const ins = withIn.map((d) => istMinutesOfDay(d.checkIn, offset)).filter((v) => v !== null);
  const outs = elapsed.filter((d) => d.checkOut).map((d) => istMinutesOfDay(d.checkOut, offset)).filter((v) => v !== null);
  const worked = elapsed.filter((d) => d.workedMinutes > 0);
  // A day waiting for an out time is paid as present until HR / admin decides (as payroll counts it).
  const present = count((d) => ['PRESENT', 'WFH', 'REVIEW'].includes(d.status));
  const half = count((d) => d.status === 'HALF_DAY');
  const leaveDays = elapsed.filter((d) => d.status === 'LEAVE').reduce((sum, d) => sum + (d.dayPart === 'FULL' ? 1 : 0.5), 0);
  const scheduled = workdays.filter((d) => !['NOT_MARKED', 'IN_PROGRESS'].includes(d.status)).length;
  const summary = {
    month,
    workingDays: days.filter((d) => !['HOLIDAY', 'WEEK_OFF', 'NOT_JOINED'].includes(d.status)).length,
    elapsedWorkingDays: scheduled,
    present,
    wfh: count((d) => d.status === 'WFH'),
    halfDays: half,
    absent: count((d) => d.status === 'ABSENT'),
    leaveDays,
    holidays: days.filter((d) => d.isHoliday).length,
    weekOffs: days.filter((d) => d.status === 'WEEK_OFF').length,
    lateDays: count((d) => d.lateMinutes > 0 && d.status !== 'IN_PROGRESS'),
    lateMinutes: elapsed.reduce((sum, d) => sum + (d.status === 'IN_PROGRESS' ? 0 : Number(d.lateMinutes || 0)), 0),
    earlyLeaveDays: count((d) => d.earlyLeaveMinutes > 0),
    missingPunches: count((d) => d.missingPunch),
    needsReview: count((d) => d.needsReview),
    lopDays: Math.round(elapsed.reduce((sum, d) => sum + Number(d.lopDays || 0), 0) * 100) / 100,
    pendingRequests: days.filter((d) => d.pendingRegularization || d.pendingLeave).length,
    avgCheckIn: ins.length ? hhmm(ins.reduce((a, b) => a + b, 0) / ins.length) : '',
    avgCheckOut: outs.length ? hhmm(outs.reduce((a, b) => a + b, 0) / outs.length) : '',
    totalWorkedMinutes: worked.reduce((sum, d) => sum + d.workedMinutes, 0),
    avgWorkedMinutes: worked.length ? Math.round(worked.reduce((sum, d) => sum + d.workedMinutes, 0) / worked.length) : 0,
    // lateMinutes already leaves out arrivals inside the grace.
    onTimeRate: withIn.length ? Math.round((withIn.filter((d) => !(Number(d.lateMinutes) > 0)).length / withIn.length) * 100) : null,
    attendanceRate: scheduled ? Math.round(((present + half * 0.5 + leaveDays) / scheduled) * 100) : null
  };
  return { employee, month, today: dateKey(today), days, summary };
}


module.exports = { buildCalendar, shiftOn, istMinutesOfDay, hhmm, PUNCH_SOURCES };
