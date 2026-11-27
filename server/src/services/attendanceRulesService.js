const AttendancePolicy = require('../models/AttendancePolicy');
const Attendance = require('../models/Attendance');
const PermissionRequest = require('../models/PermissionRequest');
const Regularization = require('../models/Regularization');
const ShiftAssignment = require('../models/ShiftAssignment');
const Shift = require('../models/Shift');
const { monthRange, startOfDay, endOfDay, dateKey, calendarDay } = require('../utils/date');
const { computeShiftWindow, minutesBetween, statusFromWorkedMinutes, resolveTimezoneOffset, measureAgainstWindow, effectiveGraceMinutes, assignmentAppliesOnWeekday, latestAssignmentOn } = require('../utils/shift');

const policyCache = require('./policyCache');
const { freeze, thaw } = require('./memoCache');

/** The company's attendance policy (cached for a minute, cleared when it is saved). */
async function getPolicy(tenantId) {
  const cached = policyCache.get(tenantId);
  if (cached) return thaw(AttendancePolicy, cached);
  let policy = await AttendancePolicy.findOne({ tenantId });
  if (!policy) policy = await AttendancePolicy.create({ tenantId });
  policyCache.set(tenantId, freeze(policy));
  return policy;
}


function employeeKey(value) {
  return String(value?._id || value || '');
}

/**
 * Writes the evaluation only when it changed something. Opening a calendar or
 * re-checking a month used to rewrite every day every time (one database trip
 * each, far away on Render); now unchanged days cost nothing.
 */
function saveIfChanged(attendance, policy) {
  if (!attendance.isNew && attendance.evaluatedAt && !attendance.isModified()) return attendance;
  attendance.evaluatedAt = new Date();
  attendance.policySnapshot = typeof policy?.toObject === 'function' ? policy.toObject() : policy;
  return attendance.save();
}

async function getShiftForDate({ tenantId, employeeId, date, context }) {
  const day = startOfDay(date);
  if (context?.shiftAssignmentsByEmployee) {
    const rows = context.shiftAssignmentsByEmployee.get(employeeKey(employeeId)) || [];
    const assignment = [...rows].reverse().find((row) => {
      const from = row.fromDate ? startOfDay(row.fromDate) : new Date(0);
      const to = row.toDate ? new Date(new Date(row.toDate).setHours(23, 59, 59, 999)) : new Date(8640000000000000);
      return day >= from && day <= to && assignmentAppliesOnWeekday(row, day);
    });
    return assignment?.shiftId || context.defaultShift || null;
  }
  const assignment = await latestAssignmentOn({ tenantId, employeeId, day });
  if (assignment?.shiftId) return assignment.shiftId;
  return Shift.findOne({ tenantId, active: true }).sort('createdAt');
}

function permissionLikeFromRegularization(row) {
  if (!row) return null;
  const obj = row.toObject ? row.toObject() : row;
  return {
    ...obj,
    type: obj.requestType,
    countedInMonthlyLimit: ['LATE_IN', 'EARLY_LEAVE'].includes(obj.requestType),
    _source: 'REGULARIZATION'
  };
}

function permissionLikeFromLegacy(row) {
  if (!row) return null;
  const obj = row.toObject ? row.toObject() : row;
  return { ...obj, _source: 'LEGACY_PERMISSION' };
}

async function approvedPermissionFor({ tenantId, employeeId, date, types, context }) {
  if (context?.permissionsByEmployeeDate) {
    const rows = context.permissionsByEmployeeDate.get(`${employeeKey(employeeId)}:${dateKey(date)}`) || [];
    return rows.find((row) => types.includes(row.type)) || null;
  }
  const [legacy, regularization] = await Promise.all([
    PermissionRequest.findOne({
      tenantId,
      employeeId,
      status: 'APPROVED',
      type: { $in: types },
      date: startOfDay(date)
    }).sort('createdAt'),
    Regularization.findOne({
      tenantId,
      employeeId,
      status: 'APPROVED',
      requestType: { $in: types },
      date: startOfDay(date)
    }).sort('createdAt')
  ]);
  const candidates = [permissionLikeFromLegacy(legacy), permissionLikeFromRegularization(regularization)]
    .filter(Boolean)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  return candidates[0] || null;
}

async function monthlyApprovedPermissionCount({ tenantId, employeeId, month, date, context }) {
  if (context?.permissionCountsByEmployeeDate && date) {
    return context.permissionCountsByEmployeeDate.get(`${employeeKey(employeeId)}:${dateKey(date)}`) || 0;
  }
  const { from, to } = monthRange(month);
  const through = date ? endOfDay(date) : to;
  const [legacyCount, regularizationCount] = await Promise.all([
    PermissionRequest.countDocuments({
      tenantId,
      employeeId,
      status: 'APPROVED',
      countedInMonthlyLimit: true,
      type: { $in: ['LATE_IN', 'EARLY_LEAVE'] },
      date: { $gte: from, $lte: through }
    }),
    Regularization.countDocuments({
      tenantId,
      employeeId,
      status: 'APPROVED',
      requestType: { $in: ['LATE_IN', 'EARLY_LEAVE'] },
      date: { $gte: from, $lte: through }
    })
  ]);
  return legacyCount + regularizationCount;
}

async function lateGraceUsedBefore({ tenantId, employeeId, date, context }) {
  if (context?.graceCountsByEmployee) return context.graceCountsByEmployee.get(employeeKey(employeeId)) || 0;
  const d = new Date(date);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { from } = monthRange(month);
  return Attendance.countDocuments({
    tenantId,
    employeeId,
    date: { $gte: from, $lt: startOfDay(date) },
    graceUsed: true
  });
}

async function monthlyExceptionEventsUsedBefore({ tenantId, employeeId, date, context }) {
  // The company rule is a COMBINED monthly quota: late-in + early-leave events.
  // Count events, not days and not only approved permission requests. This makes the
  // first three exceptions deterministic even when no regularization request exists.
  if (context?.exceptionCountsByEmployee) return context.exceptionCountsByEmployee.get(employeeKey(employeeId)) || 0;
  const d = new Date(date);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { from } = monthRange(month);
  // The old $nin excluded LEAVE/WFH/HOLIDAY/WEEK_OFF but NOT ABSENT or HALF_DAY,
  // so an absent day carrying late/early minutes silently burned one of the three
  // monthly exceptions. An absent day is a flat 1-day LOP; the exception quota is
  // a benefit that only exists for a day the employee actually worked.
  const rows = await Attendance.find({
    tenantId,
    employeeId,
    date: { $gte: from, $lt: startOfDay(date) },
    status: { $in: ['PRESENT', 'WFH'] },
    $or: [
      { exceptionEventsCounted: { $gt: 0 } },
      { lateMinutes: { $gt: 0 } },
      { earlyLeaveMinutes: { $gt: 0 } }
    ]
  }).select('lateMinutes earlyLeaveMinutes exceptionEventsCounted evaluatedAt').lean();
  return rows.reduce((count, row) => {
    // Re-evaluated rows carry the authoritative count. Legacy rows fall back to
    // deriving it from the minutes, and the status filter above already keeps
    // absent/half days out of that fallback.
    if (row.evaluatedAt && row.exceptionEventsCounted !== undefined && row.exceptionEventsCounted !== null) {
      return count + Number(row.exceptionEventsCounted || 0);
    }
    return count + (Number(row.lateMinutes || 0) > 0 ? 1 : 0) + (Number(row.earlyLeaveMinutes || 0) > 0 ? 1 : 0);
  }, 0);
}

function baseLopForStatus(status) {
  if (status === 'ABSENT') return 1;
  if (status === 'HALF_DAY') return 0.5;
  return 0;
}

function applyCustomRules({ policy, status, lateMinutes, earlyLeaveMinutes, currentLop, reasons, protectLate = false, protectEarly = false }) {
  let lopDays = currentLop;
  for (const rule of (policy.customRules || [])
    .filter((r) => r.active !== false)
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100))) {
    if (!protectLate && rule.condition === 'LATE_IN_MINUTES_GT' && lateMinutes > Number(rule.thresholdMinutes || 0)) {
      lopDays += Number(rule.lopDays || 0);
      reasons.push(`${rule.name || 'Custom late rule'} applied`);
    }
    if (!protectEarly && rule.condition === 'EARLY_LEAVE_MINUTES_GT' && earlyLeaveMinutes > Number(rule.thresholdMinutes || 0)) {
      lopDays += Number(rule.lopDays || 0);
      reasons.push(`${rule.name || 'Custom early-leave rule'} applied`);
    }
    // A half-day rule must never charge the same half day twice.
    if (rule.condition === 'HALF_DAY' && status === 'HALF_DAY') {
      lopDays = Math.max(lopDays, Number(rule.lopDays || 0.5));
      reasons.push(`${rule.name || 'Custom half-day rule'} applied`);
    }
    if (rule.condition === 'ABSENT' && status === 'ABSENT') {
      lopDays = Math.max(lopDays, Number(rule.lopDays || 1));
      reasons.push(`${rule.name || 'Custom absence rule'} applied`);
    }
  }
  return lopDays;
}

async function evaluateAttendanceRecord(attendance, context = null) {
  const policy = context?.policy || await getPolicy(attendance.tenantId);
  const protectedStatus = ['LEAVE', 'WFH', 'HOLIDAY', 'WEEK_OFF'].includes(attendance.status);

  if (protectedStatus) {
    attendance.lateMinutes = 0;
    attendance.earlyLeaveMinutes = 0;
    attendance.exceptionEventsCounted = 0;
    attendance.graceUsed = false;

    if (!attendance.lopOverride?.enabled) {
      const isHalfDayLeave = attendance.status === 'LEAVE' && ['FIRST_HALF', 'SECOND_HALF'].includes(attendance.dayPart);
      const hasWorkedPair = Boolean(
        attendance.checkIn &&
        attendance.checkOut &&
        new Date(attendance.checkOut) > new Date(attendance.checkIn)
      );
      // A paid half-day leave covers only half the duty day. The other half is payable
      // only when a valid worked punch pair exists; otherwise it is 0.5 LOP.
      attendance.lopDays = isHalfDayLeave && !hasWorkedPair ? 0.5 : 0;
    }

    attendance.deductionReason = attendance.status === 'LEAVE' && Number(attendance.lopDays || 0) > 0
      ? 'Half-day leave approved; remaining half requires attendance or regularization'
      : (attendance.deductionReason || '');
    attendance.needsReview = false;
    return saveIfChanged(attendance, policy);
  }

  const shift = await getShiftForDate({
    tenantId: attendance.tenantId,
    employeeId: attendance.employeeId,
    date: attendance.date,
    context
  });

  // No shift or incomplete punch: preserve explicit HALF_DAY/ABSENT deductions,
  // but do not invent late/early deductions before checkout exists. When a complete
  // punch pair exists, still reject impossible zero/negative durations even without
  // a shift assignment.
  if (!shift || !attendance.checkIn || !attendance.checkOut) {
    attendance.lateMinutes = 0;
    attendance.earlyLeaveMinutes = 0;
    attendance.exceptionEventsCounted = 0;
    attendance.graceUsed = false;
    const punchDriven = ['BIOMETRIC', 'MOBILE_GEOFENCE', 'ANYWHERE'].includes(attendance.source);
    const attendanceDay = startOfDay(attendance.date);
    const today = startOfDay(new Date());

    const onePunch = Boolean(attendance.checkIn) !== Boolean(attendance.checkOut);
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    // Yesterday's punch may still be open (a night shift, or the hourly auto-close
    // has not run yet). Older days, and days the system closed, are settled.
    const dayIsClosed = Boolean(attendance.autoClosed || attendance.missingCheckOut) || attendanceDay < yesterday;
    // Assigned once at the end: flipping a path false then back to true would
    // mark it modified and rewrite an unchanged day on every calendar view.
    let needsReview = false;
    if (attendance.checkIn && attendance.checkOut && punchDriven) {
      attendance.status = statusFromWorkedMinutes(shift, attendance.checkIn, attendance.checkOut, 'PRESENT', { belowHalfDayStatus: policy.belowHalfDayStatus });
    } else if (punchDriven && !attendance.checkIn && !attendance.checkOut && attendanceDay < today) {
      attendance.status = 'ABSENT';
      attendance.deductionReason = 'No punch recorded';
    } else if (punchDriven && onePunch && attendanceDay < today && dayIsClosed && !attendance.lopOverride?.enabled) {
      // One punch on a closed day: the out (or in) time is missing. That is never
      // loss of pay on its own: the day waits, shown in yellow, until HR / admin
      // decides from the calendar (present, half day, absent, or the real time).
      attendance.status = 'PRESENT';
      needsReview = true;
      attendance.deductionReason = attendance.checkIn
        ? 'Out time missing: waiting for HR / admin to decide. No loss of pay until then.'
        : 'In time missing: waiting for HR / admin to decide. No loss of pay until then.';
    }
    attendance.needsReview = needsReview;
    const calculatedLop = needsReview ? 0 : baseLopForStatus(attendance.status);
    if (attendance.lopOverride?.enabled) {
      attendance.lopOverride.originalLopDays = calculatedLop;
      attendance.lopDays = Number(attendance.lopOverride.overrideLopDays || 0);
    } else {
      attendance.lopDays = calculatedLop;
    }
    return saveIfChanged(attendance, policy);
  }

  const window = computeShiftWindow(shift, attendance.date, resolveTimezoneOffset(policy));
  // Late counts only from the first second after the grace (10:15:00 for a 10:00
  // start with 15 min), and early leave only beyond the policy's early tolerance.
  const measured = measureAgainstWindow({
    window,
    checkIn: attendance.checkIn,
    checkOut: attendance.checkOut,
    graceMinutes: effectiveGraceMinutes(policy, shift),
    earlyToleranceMinutes: Number(policy.earlyLeaveAllowedMinutes || 0)
  });
  attendance.needsReview = false;
  const lateMinutes = measured.lateMinutes;
  const earlyLeaveMinutes = measured.earlyLeaveMinutes;
  const workedMinutes = measured.workedMinutes;
  const d = new Date(attendance.date);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const latePermission = await approvedPermissionFor({
    tenantId: attendance.tenantId,
    employeeId: attendance.employeeId,
    date: attendance.date,
    types: ['LATE_IN', 'MEDICAL', 'SPECIAL'],
    context
  });
  const earlyPermission = await approvedPermissionFor({
    tenantId: attendance.tenantId,
    employeeId: attendance.employeeId,
    date: attendance.date,
    types: ['EARLY_LEAVE', 'MEDICAL', 'SPECIAL'],
    context
  });
  const usedExceptions = await monthlyExceptionEventsUsedBefore({
    tenantId: attendance.tenantId,
    employeeId: attendance.employeeId,
    date: attendance.date,
    context
  });

  let status = attendance.status || 'PRESENT';
  const reasons = [];

  // Punch-driven attendance must be classified from actual worked duration. This
  // prevents records with identical in/out times from remaining PRESENT and also
  // turns short duty windows into HALF_DAY/ABSENT according to the assigned shift.
  const punchDrivenSource = ['BIOMETRIC', 'MOBILE_GEOFENCE', 'ANYWHERE'].includes(attendance.source);
  // The physical classification is computed now but APPLIED LATER. A day whose
  // only shortfall is a permitted late-in / early-leave must not silently become
  // a HALF_DAY: that was the bug where a late punch on the 1st of the month was
  // reported as "permitted as per rule" and still charged 0.5 LOP.
  const physicalStatus = punchDrivenSource
    ? statusFromWorkedMinutes(shift, attendance.checkIn, attendance.checkOut, 'PRESENT', { belowHalfDayStatus: policy.belowHalfDayStatus })
    : status;
  for (const anomaly of measured.anomalies) reasons.push(anomaly);
  let graceUsed = false;
  let latePenalty = 0;
  let earlyPenalty = 0;
  let protectLateFromCustomPenalty = false;
  let protectEarlyFromCustomPenalty = false;
  let forgivenMinutes = 0;
  // An ABSENT day never touches the exception quota. It is a flat full-day LOP,
  // so the late/early machinery below is skipped entirely for it.
  const dayIsAbsent = physicalStatus === 'ABSENT';
  if (dayIsAbsent && (lateMinutes > 0 || earlyLeaveMinutes > 0)) {
    reasons.push('Absent day: full-day LOP applies and the monthly late/early exception quota is not consumed');
  }
  const combinedQuota = Math.max(0, Number(policy.permissionLimitPerMonth ?? policy.lateGraceDaysPerMonth ?? 3));
  let exceptionCursor = usedExceptions;

  // Company rule: late-in and early-leave share ONE monthly exception counter.
  // The first N events are permitted without LOP. After the quota, every later
  // event attracts the configured 0.5 LOP. A late event alone never changes the
  // physical attendance status to HALF_DAY merely because worked minutes are a
  // little below the old fullDayMinutes value.
  if (lateMinutes > 0 && !dayIsAbsent) {
    exceptionCursor += 1;
    const protectedSpecial = latePermission && ['MEDICAL', 'SPECIAL'].includes(latePermission.type);
    if (protectedSpecial) {
      protectLateFromCustomPenalty = true;
      forgivenMinutes += lateMinutes;
      reasons.push(`Late ${lateMinutes}m specially approved`);
      attendance.permissionRequestId = latePermission._id;
    } else if (exceptionCursor <= combinedQuota) {
      protectLateFromCustomPenalty = true;
      forgivenMinutes += lateMinutes;
      reasons.push(`Monthly late/early exception ${exceptionCursor}/${combinedQuota}: late ${lateMinutes}m permitted`);
      if (latePermission) attendance.permissionRequestId = latePermission._id;
    } else {
      latePenalty = Number(policy.lateLopAfterGraceDays || 0.5);
      reasons.push(`Monthly late/early quota exhausted (${combinedQuota}); late ${lateMinutes}m: ${latePenalty} LOP`);
    }
  }

  if (earlyLeaveMinutes > 0 && !dayIsAbsent) {
    exceptionCursor += 1;
    const protectedSpecial = earlyPermission && ['MEDICAL', 'SPECIAL'].includes(earlyPermission.type);
    const hardHalfDay = earlyLeaveMinutes > Number(policy.earlyLeaveHalfDayAfterMinutes || 120);
    if (protectedSpecial) {
      protectEarlyFromCustomPenalty = true;
      forgivenMinutes += earlyLeaveMinutes;
      reasons.push(`Early leave ${earlyLeaveMinutes}m specially approved`);
      attendance.permissionRequestId = earlyPermission._id;
    } else if (hardHalfDay) {
      // The explicit early-leave half-day threshold is stronger than the monthly
      // exception quota. This is the only normal early-leave path that changes
      // the attendance classification to HALF_DAY.
      earlyPenalty = Math.max(Number(policy.earlyLeaveLopDays || 0.5), 0.5);
      if (status !== 'ABSENT') status = 'HALF_DAY';
      reasons.push(`Early leave ${earlyLeaveMinutes}m crossed half-day threshold (${policy.earlyLeaveHalfDayAfterMinutes}m): ${earlyPenalty} LOP`);
    } else if (exceptionCursor <= combinedQuota) {
      protectEarlyFromCustomPenalty = true;
      forgivenMinutes += earlyLeaveMinutes;
      reasons.push(`Monthly late/early exception ${exceptionCursor}/${combinedQuota}: early leave ${earlyLeaveMinutes}m permitted`);
      if (earlyPermission) attendance.permissionRequestId = earlyPermission._id;
    } else {
      earlyPenalty = Number(policy.earlyLeaveLopDays || policy.lateLopAfterGraceDays || 0.5);
      reasons.push(`Monthly late/early quota exhausted (${combinedQuota}); early leave ${earlyLeaveMinutes}m: ${earlyPenalty} LOP`);
    }
  }

  // ---- Deferred status resolution -------------------------------------------
  // A permitted exception forgives the minutes it caused. If the worked time plus
  // those forgiven minutes covers the shift, the day stays PRESENT and carries no
  // base LOP. Only a genuine shortfall (unexplained by any permitted exception)
  // or the hard early-leave half-day threshold can downgrade the day.
  if (physicalStatus !== status && physicalStatus === 'HALF_DAY') {
    const covered = workedMinutes + forgivenMinutes;
    const shiftMinutes = Number(window.durationMinutes || 0);
    const halfThreshold = Number(shift?.halfDayMinutes || 0) > 0
      ? Number(shift.halfDayMinutes)
      : Math.floor(shiftMinutes / 2);
    if (forgivenMinutes > 0 && covered >= halfThreshold) {
      reasons.push(`Worked ${workedMinutes}m + ${forgivenMinutes}m permitted exception covers the duty day: kept PRESENT, no LOP`);
    } else {
      status = physicalStatus;
      reasons.push(`Worked ${workedMinutes}m classified as ${physicalStatus}`);
    }
  } else if (physicalStatus !== status) {
    status = physicalStatus;
    reasons.push(`Worked ${workedMinutes}m classified as ${physicalStatus}`);
  }

  const baseLopAfterStatus = baseLopForStatus(status);

  // Avoid charging a HALF_DAY twice for the same short attendance. Separate late + early
  // violations may still combine up to one full LOP day.
  let lopDays = Math.max(baseLopAfterStatus, latePenalty + earlyPenalty);
  lopDays = applyCustomRules({ policy, status, lateMinutes, earlyLeaveMinutes, currentLop: lopDays, reasons, protectLate: protectLateFromCustomPenalty, protectEarly: protectEarlyFromCustomPenalty });

  // The exception quota is only spent on a day the employee actually worked.
  // Absent days spend nothing. A half-day that the forgiveness failed to rescue
  // spends nothing either: the 0.5 base LOP already governs, so charging an
  // exception on top would take the benefit away without giving anything back.
  const dayIsWorked = ['PRESENT', 'WFH'].includes(status);
  const exceptionEventsCounted = dayIsWorked && !dayIsAbsent
    ? (lateMinutes > 0 ? 1 : 0) + (earlyLeaveMinutes > 0 ? 1 : 0)
    : 0;
  if (!dayIsWorked && !dayIsAbsent && (lateMinutes > 0 || earlyLeaveMinutes > 0)) {
    reasons.push(`Day settled as ${status}: monthly exception quota refunded (base ${baseLopAfterStatus} LOP governs)`);
  }

  if (measured.withinGrace) {
    graceUsed = true;
    reasons.push(`Arrived within the ${effectiveGraceMinutes(policy, shift)} min grace: on time`);
  }
  attendance.lateMinutes = lateMinutes;
  attendance.earlyLeaveMinutes = earlyLeaveMinutes;
  attendance.exceptionEventsCounted = exceptionEventsCounted;
  attendance.graceUsed = graceUsed;
  const calculatedLop = Math.min(Math.max(Number(lopDays || 0), 0), 1);

  if (attendance.lopOverride?.enabled) {
    attendance.lopOverride.originalLopDays = calculatedLop;
    attendance.lopDays = Number(attendance.lopOverride.overrideLopDays || 0);
    reasons.push(`LOP overridden to ${attendance.lopDays} by HR/Admin: ${attendance.lopOverride.reason || ''}`);
  } else {
    attendance.lopDays = calculatedLop;
  }

  // Preserve the physical attendance classification. A genuine half-day remains HALF_DAY;
  // lateness-only LOP does not falsely turn a present punch into HALF_DAY.
  attendance.status = status;
  attendance.deductionReason = reasons.join('; ');
  return saveIfChanged(attendance, policy);
}

async function evaluateMonth({ tenantId, employeeIds, month, filter = null, returnAll = false }) {
  const { from, to } = monthRange(month);
  const q = { tenantId, date: { $gte: from, $lte: to } };
  if (employeeIds?.length) q.employeeId = { $in: employeeIds };
  const rows = await Attendance.find(q).sort('employeeId date');
  if (!rows.length) return [];

  const ids = Array.from(new Set(rows.map((row) => employeeKey(row.employeeId))));
  const [policy, assignments, permissions, regularizations, defaultShift] = await Promise.all([
    getPolicy(tenantId),
    ShiftAssignment.find({
      tenantId,
      employeeId: { $in: ids },
      fromDate: { $lte: to },
      $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: from } }]
    }).populate('shiftId').sort('fromDate createdAt'),
    PermissionRequest.find({
      tenantId,
      employeeId: { $in: ids },
      status: 'APPROVED',
      date: { $gte: from, $lte: to }
    }).sort('date createdAt'),
    Regularization.find({
      tenantId,
      employeeId: { $in: ids },
      status: 'APPROVED',
      requestType: { $in: ['LATE_IN', 'EARLY_LEAVE', 'MEDICAL', 'SPECIAL'] },
      date: { $gte: from, $lte: to }
    }).sort('date createdAt'),
    Shift.findOne({ tenantId, active: true }).sort('createdAt')
  ]);

  const shiftAssignmentsByEmployee = new Map();
  for (const assignment of assignments) {
    const key = employeeKey(assignment.employeeId);
    if (!shiftAssignmentsByEmployee.has(key)) shiftAssignmentsByEmployee.set(key, []);
    shiftAssignmentsByEmployee.get(key).push(assignment);
  }

  const permissionsByEmployeeDate = new Map();
  const permissionCountsByEmployeeDate = new Map();
  const unifiedPermissions = [
    ...permissions.map(permissionLikeFromLegacy),
    ...regularizations.map(permissionLikeFromRegularization)
  ].filter(Boolean).sort((a, b) => {
    const empCompare = employeeKey(a.employeeId).localeCompare(employeeKey(b.employeeId));
    if (empCompare) return empCompare;
    const dateCompare = new Date(a.date || 0) - new Date(b.date || 0);
    if (dateCompare) return dateCompare;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });

  const runningQuota = new Map();
  for (const permission of unifiedPermissions) {
    const emp = employeeKey(permission.employeeId);
    if (permission.countedInMonthlyLimit && ['LATE_IN', 'EARLY_LEAVE'].includes(permission.type)) {
      const next = (runningQuota.get(emp) || 0) + 1;
      runningQuota.set(emp, next);
      permission._quotaOrdinal = next;
    }
    const key = `${emp}:${dateKey(permission.date)}`;
    if (!permissionsByEmployeeDate.has(key)) permissionsByEmployeeDate.set(key, []);
    permissionsByEmployeeDate.get(key).push(permission);
    permissionCountsByEmployeeDate.set(key, runningQuota.get(emp) || 0);
  }

  const context = {
    policy,
    defaultShift,
    shiftAssignmentsByEmployee,
    permissionsByEmployeeDate,
    permissionCountsByEmployeeDate,
    graceCountsByEmployee: new Map(),
    exceptionCountsByEmployee: new Map()
  };

  const evaluated = [];
  const all = [];
  for (const row of rows) {
    // A skipped row (an open punch the calendar leaves alone) still counts its
    // stored late/early events, so the days after it read the right quota.
    const skip = Boolean(filter && !filter(row));
    const result = skip ? row : await evaluateAttendanceRecord(row, context);
    if (!skip) evaluated.push(result);
    all.push(result);
    const key = employeeKey(result.employeeId);
    if (result.graceUsed) {
      context.graceCountsByEmployee.set(key, (context.graceCountsByEmployee.get(key) || 0) + 1);
    }
    // Read the authoritative per-day figure instead of re-deriving it from the
    // minutes. Re-deriving ignored status, which is how absent days were leaking
    // into the running quota during a full-month re-evaluation.
    const exceptionEvents = Number(result.exceptionEventsCounted || 0);
    if (exceptionEvents) context.exceptionCountsByEmployee.set(key, (context.exceptionCountsByEmployee.get(key) || 0) + exceptionEvents);
  }
  return returnAll ? all : evaluated;
}

module.exports = {
  getPolicy,
  evaluateAttendanceRecord,
  evaluateMonth,
  monthlyApprovedPermissionCount,
  monthlyExceptionEventsUsedBefore,
  baseLopForStatus,
  applyCustomRules
};
