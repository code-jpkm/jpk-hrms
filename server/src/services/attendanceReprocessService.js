const Attendance = require('../models/Attendance');
const RawPunchLog = require('../models/RawPunchLog');
const Employee = require('../models/Employee');
const { startOfDay, endOfDay, eachDate, dateKey, calendarDay } = require('../utils/date');
const { resolveAttendanceDateForPunch, statusFromWorkedMinutes } = require('../utils/shift');
const { evaluateAttendanceRecord } = require('./attendanceRulesService');

const PROTECTED_STATUSES = ['LEAVE', 'WFH', 'HOLIDAY', 'WEEK_OFF'];
const PROTECTED_SOURCES = ['OVERRIDE'];

function dayKey(date) {
  return dateKey(date);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function isProtectedAttendance(attendance, { force = false } = {}) {
  if (!attendance) return false;
  if (force) return false;
  if (PROTECTED_SOURCES.includes(attendance.source)) return true;
  if (PROTECTED_STATUSES.includes(attendance.status)) return true;
  if (attendance.lopOverride?.enabled) return true;
  return false;
}

async function getEmployeeMatcher(tenantId, employeeId) {
  const employee = await Employee.findOne({ tenantId, _id: employeeId });
  if (!employee) return { employee: null, rawQuery: null };
  const values = Array.from(new Set([
    String(employee._id),
    employee.employeeCode,
    employee.biometric?.code,
    employee.biometric?.deviceUserId
  ].filter(Boolean).map((v) => String(v).trim())));

  const or = [{ employeeId: employee._id }];
  if (values.length) {
    or.push({ employeeCode: { $in: values } });
    or.push({ deviceUserId: { $in: values } });
  }
  return { employee, rawQuery: { tenantId, $or: or } };
}

async function rebuildAttendanceFromRawPunches({ tenantId, employeeId, fromDate, toDate, force = false, reason = 'Shift assignment changed', changedBy }) {
  const from = startOfDay(fromDate || new Date());
  const to = endOfDay(toDate || fromDate || new Date());
  const { employee, rawQuery } = await getEmployeeMatcher(tenantId, employeeId);
  if (!employee) return { employeeId, skipped: true, reason: 'Employee not found' };

  const rawPunches = await RawPunchLog.find({
    ...rawQuery,
    timestamp: { $gte: addDays(from, -1), $lte: addDays(to, 1) }
  }).sort('timestamp');

  const groups = new Map();
  let consideredPunches = 0;
  for (const punch of rawPunches) {
    const resolved = await resolveAttendanceDateForPunch({ tenantId, employeeId, timestamp: punch.timestamp });
    const attendanceDate = startOfDay(resolved.attendanceDate || punch.timestamp);
    if (attendanceDate < startOfDay(from) || attendanceDate > startOfDay(to)) continue;
    consideredPunches += 1;
    const key = dayKey(attendanceDate);
    if (!groups.has(key)) groups.set(key, { date: attendanceDate, shift: resolved.shift, punches: [] });
    groups.get(key).punches.push(punch);
  }

  const summary = {
    employeeId: String(employee._id),
    employeeCode: employee.employeeCode,
    employeeName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
    fromDate: from,
    toDate: startOfDay(to),
    rawPunches: rawPunches.length,
    consideredPunches,
    updated: 0,
    created: 0,
    markedAbsent: 0,
    protectedSkipped: 0,
    unchanged: 0,
    errors: []
  };

  const dates = eachDate(from, to);
  const today = startOfDay(new Date());
  for (const date of dates) {
    const key = dayKey(date);
    const group = groups.get(key);
    const existing = await Attendance.findOne({ tenantId, employeeId, date: startOfDay(date) });

    if (isProtectedAttendance(existing, { force })) {
      summary.protectedSkipped += 1;
      continue;
    }

    if (!group || !group.punches.length) {
      // Never convert today or a future duty day to ABSENT during reprocessing.
      if (startOfDay(date) >= today) {
        summary.unchanged += 1;
        continue;
      }
      if (existing && ['BIOMETRIC', 'SYSTEM'].includes(existing.source)) {
        existing.checkIn = undefined;
        existing.checkOut = undefined;
        existing.status = 'ABSENT';
        existing.source = 'SYSTEM';
        existing.lateMinutes = 0;
        existing.earlyLeaveMinutes = 0;
        existing.lopDays = 1;
        existing.graceUsed = false;
        existing.deductionReason = reason ? `Reprocessed after shift change: ${reason}` : 'Reprocessed after shift change';
        existing.evaluatedAt = new Date();
        existing.meta = { ...(existing.meta || {}), reprocessedAt: new Date(), reprocessReason: reason, reprocessedBy: changedBy };
        await existing.save();
        summary.markedAbsent += 1;
      } else {
        summary.unchanged += 1;
      }
      continue;
    }

    const sorted = group.punches
      .map((p) => new Date(p.timestamp))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);
    const distinct = sorted.filter((d, i) => i === 0 || d.getTime() !== sorted[i - 1].getTime());
    const checkIn = distinct[0];
    const checkOut = distinct.length > 1 ? distinct[distinct.length - 1] : undefined;
    const status = statusFromWorkedMinutes(group.shift, checkIn, checkOut, 'PRESENT');

    const reprocessSet = {
      tenantId,
      employeeId,
      date: startOfDay(date),
      checkIn,
      status,
      source: 'BIOMETRIC',
      biometricDeviceId: group.punches[group.punches.length - 1]?.deviceId,
      location: { siteName: group.punches[group.punches.length - 1]?.locationName },
      deductionReason: reason ? `Reprocessed after shift change: ${reason}` : undefined,
      meta: {
        shiftId: group.shift?._id,
        shiftName: group.shift?.name,
        reprocessedAt: new Date(),
        reprocessReason: reason,
        reprocessedBy: changedBy,
        rawPunchCount: group.punches.length
      }
    };
    if (checkOut) reprocessSet.checkOut = checkOut;

    const reprocessUpdate = { $set: reprocessSet };
    if (!checkOut) reprocessUpdate.$unset = { checkOut: 1 };

    const attendance = await Attendance.findOneAndUpdate(
      { tenantId, employeeId, date: startOfDay(date) },
      reprocessUpdate,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await evaluateAttendanceRecord(attendance);

    await RawPunchLog.updateMany(
      { _id: { $in: group.punches.map((p) => p._id) } },
      { $set: { employeeId: employee._id, imported: true, importedAttendanceId: attendance._id, skippedReason: undefined } }
    );

    if (existing) summary.updated += 1;
    else summary.created += 1;
  }

  return summary;
}

async function rebuildAttendanceForEmployees({ tenantId, employeeIds, fromDate, toDate, force = false, reason, changedBy }) {
  const summaries = [];
  for (const employeeId of employeeIds) {
    try {
      summaries.push(await rebuildAttendanceFromRawPunches({ tenantId, employeeId, fromDate, toDate, force, reason, changedBy }));
    } catch (error) {
      summaries.push({ employeeId: String(employeeId), error: error.message });
    }
  }
  return {
    count: summaries.length,
    updated: summaries.reduce((sum, row) => sum + Number(row.updated || 0), 0),
    created: summaries.reduce((sum, row) => sum + Number(row.created || 0), 0),
    markedAbsent: summaries.reduce((sum, row) => sum + Number(row.markedAbsent || 0), 0),
    protectedSkipped: summaries.reduce((sum, row) => sum + Number(row.protectedSkipped || 0), 0),
    summaries
  };
}

module.exports = { rebuildAttendanceFromRawPunches, rebuildAttendanceForEmployees };
