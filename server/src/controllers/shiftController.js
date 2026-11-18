const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Shift = require('../models/Shift');
const ShiftAssignment = require('../models/ShiftAssignment');
const Employee = require('../models/Employee');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { parseTimeToMinutes } = require('../utils/shift');
const { rebuildAttendanceForEmployees } = require('../services/attendanceReprocessService');
const { evaluateAttendanceRecord } = require('../services/attendanceRulesService');
const Attendance = require('../models/Attendance');
const { startOfDay, endOfDay, dateKey, companyToday } = require('../utils/date');

function normalizeShift(body) {
  const start = parseTimeToMinutes(body.startTime || '09:30');
  const end = parseTimeToMinutes(body.endTime || '18:30');
  let duration = Number(body.durationMinutes || 0);
  const crossesMidnight = Boolean(body.crossesMidnight) || end <= start || duration > 24 * 60;
  if (!duration) duration = crossesMidnight ? (end + 24 * 60 - start) : (end - start);
  return { ...body, crossesMidnight, durationMinutes: duration };
}

exports.list = asyncHandler(async (req, res) => {
  const shifts = await Shift.find({ tenantId: req.tenantId }).sort('name');
  res.json({ shifts });
});

exports.create = asyncHandler(async (req, res) => {
  const shift = await Shift.create({ ...normalizeShift(req.body), tenantId: req.tenantId });
  res.status(201).json({ shift });
});

exports.bulkCreate = asyncHandler(async (req, res) => {
  const shifts = Array.isArray(req.body.shifts) ? req.body.shifts : [];
  if (!shifts.length) throw new ApiError(400, 'shifts array is required');
  const results = [];
  for (const row of shifts) {
    const payload = { ...normalizeShift(row), tenantId: req.tenantId };
    const shift = await Shift.findOneAndUpdate({ tenantId: req.tenantId, name: payload.name }, payload, { upsert: true, new: true, setDefaultsOnInsert: true });
    results.push(shift);
  }
  res.status(201).json({ count: results.length, shifts: results });
});

exports.assign = asyncHandler(async (req, res) => {
  const { employeeId, employeeCode, employeeIds = [], employeeCodes = [], shiftId, weekdays = [], recalculateAttendance = true, forceRecalculate = false } = req.body;
  let { fromDate, toDate } = req.body;
  if (!shiftId) throw new ApiError(400, 'shiftId is required');
  const shift = await Shift.findOne({ _id: shiftId, tenantId: req.tenantId });
  if (!shift) throw new ApiError(404, 'Shift not found');

  const ids = [...(Array.isArray(employeeIds) ? employeeIds : [])];
  if (employeeId) ids.push(employeeId);
  const codes = [...(Array.isArray(employeeCodes) ? employeeCodes : [])];
  if (employeeCode) codes.push(employeeCode);
  if (!ids.length && !codes.length) throw new ApiError(400, 'Select at least one employee');

  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
  const q = { tenantId: req.tenantId, status: { $ne: 'OFFBOARDED' }, _id: { $in: allowed }, $or: [] };
  if (ids.length) q.$or.push({ _id: { $in: ids } });
  if (codes.length) q.$or.push({ employeeCode: { $in: codes } });
  const employees = await Employee.find(q).select('_id employeeCode firstName lastName');
  if (!employees.length) throw new ApiError(404, 'No matching employees found inside your Office / Factory scope');
  const matchedIds = new Set(employees.map((item) => String(item._id)));
  const requestedIdCount = new Set(ids.map(String)).size;
  if (requestedIdCount && [...new Set(ids.map(String))].some((id) => !matchedIds.has(id))) {
    throw new ApiError(403, 'One or more selected employees are outside your permitted Office / Factory scope');
  }
  if (codes.length) {
    const matchedCodes = new Set(employees.map((item) => String(item.employeeCode)));
    if ([...new Set(codes.map(String))].some((code) => !matchedCodes.has(code))) throw new ApiError(403, 'One or more selected employee codes are outside your permitted Office / Factory scope');
  }

  // v26: an assignment saved without fromDate was never found by the punch
  // resolver or the evaluator (both query fromDate <= day), so "permanent" shift
  // assignments silently did nothing. Default to today, company time.
  const ymd = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
  if (fromDate && !ymd(fromDate)) throw new ApiError(400, 'fromDate must be YYYY-MM-DD');
  if (toDate && !ymd(toDate)) throw new ApiError(400, 'toDate must be YYYY-MM-DD');
  if (!fromDate) fromDate = dateKey(companyToday());
  if (toDate && ymd(toDate) < ymd(fromDate)) throw new ApiError(400, 'The end date cannot be before the start date');
  const assignments = [];
  const selectedWeekdays = (Array.isArray(weekdays) ? weekdays : []).map(Number).filter((d)=>d >= 0 && d <= 6);
  const dates = [];
  if (selectedWeekdays.length && fromDate && toDate) {
    for (let d = new Date(`${ymd(fromDate)}T00:00:00.000Z`), end = new Date(`${ymd(toDate)}T00:00:00.000Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (selectedWeekdays.includes(d.getUTCDay())) dates.push(new Date(d));
  }
  for (const employee of employees) {
    const ranges = dates.length ? dates.map((date)=>({ fromDate: date, toDate: date })) : [{ fromDate, toDate }];
    for (const range of ranges) {
      const assignment = await ShiftAssignment.findOneAndUpdate(
        { tenantId: req.tenantId, employeeId: employee._id, fromDate: range.fromDate ? new Date(range.fromDate) : null, toDate: range.toDate ? new Date(range.toDate) : null },
        { tenantId: req.tenantId, employeeId: employee._id, shiftId, ...range, assignedBy: req.user._id },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).populate('employeeId', 'employeeCode firstName lastName').populate('shiftId');
      assignments.push(assignment);
    }
  }

  let reprocess = null;
  let reevaluatedStoredAttendance = 0;
  if (recalculateAttendance !== false && fromDate && toDate) {
    reprocess = await rebuildAttendanceForEmployees({
      tenantId: req.tenantId,
      employeeIds: employees.map((emp) => emp._id),
      fromDate,
      toDate,
      force: Boolean(forceRecalculate),
      reason: `Shift changed to ${shift.name} for ${fromDate} to ${toDate}`,
      changedBy: req.user._id
    });

    // Re-evaluate the attendance records that already exist even when the raw biometric
    // archive is incomplete. Changing a historical shift must immediately recalculate
    // late/early/LOP from the stored check-in/check-out pair.
    const storedRows = await Attendance.find({
      tenantId: req.tenantId,
      employeeId: { $in: employees.map((emp) => emp._id) },
      date: { $gte: startOfDay(fromDate), $lte: endOfDay(toDate) }
    }).sort('employeeId date');
    for (const row of storedRows) {
      if (row.lopOverride?.enabled && !forceRecalculate) continue;
      await evaluateAttendanceRecord(row);
      reevaluatedStoredAttendance += 1;
    }
  }
  res.status(201).json({ count: assignments.length, employeeCount: employees.length, matchedDates: dates.length, assignments, reprocess, reevaluatedStoredAttendance, message: `Shift assignment saved. ${reevaluatedStoredAttendance} stored attendance record(s) recalculated.` });
});

exports.reprocessAttendance = asyncHandler(async (req, res) => {
  const { employeeIds = [], employeeId, fromDate, toDate, force = false, reason = 'Manual attendance reprocess' } = req.body;
  const ids = [...(Array.isArray(employeeIds) ? employeeIds : [])];
  if (employeeId) ids.push(employeeId);
  if (!ids.length) throw new ApiError(400, 'Select at least one employee');
  if (!fromDate || !toDate) throw new ApiError(400, 'fromDate and toDate are required');

  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
  if (ids.some((id) => !allowed.includes(String(id)))) throw new ApiError(403, 'One or more selected employees are outside your permitted Office / Factory scope');
  const employees = await Employee.find({ tenantId: req.tenantId, _id: { $in: ids }, status: { $ne: 'OFFBOARDED' } }).select('_id');
  if (!employees.length) throw new ApiError(404, 'No matching employees found');

  const reprocess = await rebuildAttendanceForEmployees({
    tenantId: req.tenantId,
    employeeIds: employees.map((emp) => emp._id),
    fromDate,
    toDate,
    force: Boolean(force),
    reason,
    changedBy: req.user._id
  });
  res.json({ reprocess, message: 'Attendance reprocessed successfully using the current shift and policy rules' });
});

exports.assignments = asyncHandler(async (req, res) => {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' });
  const q = { tenantId: req.tenantId, employeeId: { $in: allowed } };
  if (req.query.employeeId) {
    if (!allowed.includes(String(req.query.employeeId))) throw new ApiError(403, 'Shift is outside your scope');
    q.employeeId = req.query.employeeId;
  }
  const assignments = await ShiftAssignment.find(q).populate('employeeId', 'employeeCode firstName lastName').populate('shiftId').sort('-fromDate');
  res.json({ assignments });
});
