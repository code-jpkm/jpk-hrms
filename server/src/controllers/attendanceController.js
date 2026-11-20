const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const Tenant = require('../models/Tenant');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const { startOfDay, endOfDay, monthRange, eachDate, dateKey, holidayDateKey, holidayAppliesTo, companyToday, parseCompanyDateTime } = require('../utils/date');
const { findAllowedSite } = require('../utils/geo');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { importBiometricLogs } = require('../services/biometricService');
const { evaluateAttendanceRecord, evaluateMonth, getPolicy } = require('../services/attendanceRulesService');
const { resolveAttendanceDateForPunch, computeShiftWindow, minutesBetween, resolveTimezoneOffset } = require('../utils/shift');
const { autoCloseStalePunches, isStillOpenForCheckout, punchMessage } = require('../services/attendanceAutoCloseService');
const { buildCalendar } = require('../services/attendanceCalendarService');
const RuleAudit = require('../models/RuleAudit');
const ShiftAssignment = require('../models/ShiftAssignment');
const Shift = require('../models/Shift');
const Regularization = require('../models/Regularization');

async function getOwnEmployee(req) {
  const employee = req.employee;
  if (!employee) throw new ApiError(400, 'No employee profile linked to this user');
  return employee;
}

async function upsertAttendance({ tenantId, employeeId, date, patch, evaluate = true }) {
  const setPatch = { date: startOfDay(date) };
  const unsetPatch = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined) unsetPatch[key] = 1;
    else setPatch[key] = value;
  }
  const update = { $set: setPatch };
  if (Object.keys(unsetPatch).length) update.$unset = unsetPatch;

  const attendance = await Attendance.findOneAndUpdate(
    { tenantId, employeeId, date: startOfDay(date) },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (evaluate) return evaluateAttendanceRecord(attendance);
  return attendance;
}

exports.listAttendance = asyncHandler(async (req, res) => {
  const allowedIds = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const q = { tenantId: req.tenantId, employeeId: { $in: allowedIds } };
  if (req.query.employeeId) {
    if (!allowedIds.includes(String(req.query.employeeId))) throw new ApiError(403, 'Employee attendance is outside your scope');
    q.employeeId = req.query.employeeId;
  }
  if (req.query.from || req.query.to) {
    q.date = {};
    if (req.query.from) q.date.$gte = startOfDay(req.query.from);
    if (req.query.to) q.date.$lte = endOfDay(req.query.to);
  }
  const attendance = await Attendance.find(q).populate('employeeId', 'employeeCode firstName lastName department').sort('-date');
  res.json({ attendance });
});

exports.employees = asyncHandler(async (req, res) => {
  const allowedIds = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const employees = await Employee.find({ tenantId: req.tenantId, _id: { $in: allowedIds }, status: { $ne: 'OFFBOARDED' } })
    .select('employeeCode firstName lastName department designation workLocation status')
    .sort('employeeCode');
  res.json({ employees });
});

exports.calendar = asyncHandler(async (req, res) => {
  const employeeId = req.query.employeeId || req.employee?._id;
  if (!employeeId) throw new ApiError(400, 'employeeId is required');
  const allowedIds = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  if (!allowedIds.includes(String(employeeId))) throw new ApiError(403, 'Attendance calendar is outside your scope');
  res.json(await buildCalendar({ tenantId: req.tenantId, employeeId, month: req.query.month }));
});

/**
 * GET /api/attendance/team-today?date=YYYY-MM-DD&location=OFFICE|FACTORY
 * One row per visible employee for a single day: punched in, late, on leave,
 * week-off / holiday, or not in yet / absent. Drives the live team board.
 */
exports.teamToday = asyncHandler(async (req, res) => {
  const today = companyToday();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? new Date(`${req.query.date}T00:00:00.000Z`) : today;
  const allowedIds = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const q = { tenantId: req.tenantId, _id: { $in: allowedIds }, status: { $ne: 'OFFBOARDED' } };
  const location = String(req.query.location || '').toUpperCase();
  if (['OFFICE', 'FACTORY'].includes(location)) q.workLocation = { $in: [location, 'BOTH'] };
  const employees = await Employee.find(q).select('employeeCode firstName lastName department designation workLocation dateOfJoining phone userId').sort('employeeCode').lean();
  const ids = employees.map((e) => e._id);
  const policy = await getPolicy(req.tenantId);
  const offset = resolveTimezoneOffset(policy);
  const [rows, leaves, assignments, defaultShift, holidays] = await Promise.all([
    Attendance.find({ tenantId: req.tenantId, employeeId: { $in: ids }, date: day }).lean(),
    LeaveRequest.find({ tenantId: req.tenantId, employeeId: { $in: ids }, status: 'APPROVED', fromDate: { $lte: endOfDay(day) }, toDate: { $gte: day } }).select('employeeId requestType leaveType dayPart').lean(),
    ShiftAssignment.find({ tenantId: req.tenantId, employeeId: { $in: ids }, fromDate: { $lte: day }, $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: day } }] }).populate('shiftId').sort('fromDate').lean(),
    Shift.findOne({ tenantId: req.tenantId, active: true }).sort('createdAt').lean(),
    Holiday.find({ tenantId: req.tenantId, date: { $gte: new Date(day.getTime() - 86400000), $lte: new Date(day.getTime() + 86400000) } }).lean()
  ]);
  const key = dateKey(day);
  const dayHolidays = holidays.filter((h) => holidayDateKey(h) === key && !h.optional);
  const rowBy = new Map(rows.map((r) => [String(r.employeeId), r]));
  const leaveBy = new Map(leaves.map((l) => [String(l.employeeId), l]));
  const shiftBy = new Map();
  for (const a of assignments) shiftBy.set(String(a.employeeId), a.shiftId); // sorted by fromDate: latest wins
  const now = new Date();
  const out = employees.map((e) => {
    const id = String(e._id);
    const r = rowBy.get(id);
    const leave = leaveBy.get(id);
    const shift = shiftBy.get(id) || defaultShift;
    const window = shift ? computeShiftWindow(shift, day, offset) : null;
    const holiday = dayHolidays.find((h) => holidayAppliesTo(h, e.workLocation));
    const weeklyOff = (Array.isArray(shift?.weeklyOffDays) && shift.weeklyOffDays.length ? shift.weeklyOffDays : [0]).includes(day.getUTCDay());
    let state;
    if (r?.checkIn && !r?.checkOut) state = 'IN';
    else if (r?.checkIn && r?.checkOut) state = 'DONE';
    else if (leave) state = leave.requestType === 'WFH' ? 'WFH' : 'LEAVE';
    else if (r?.status === 'LEAVE' || r?.status === 'WFH') state = r.status;
    else if (holiday) state = 'HOLIDAY';
    else if (weeklyOff) state = 'WEEK_OFF';
    else if (day < today) state = 'ABSENT';
    else if (day > today) state = 'UPCOMING';
    else if (window && now < new Date(window.start.getTime() + Number(shift.graceMinutes || 0) * 60000)) state = 'NOT_YET';
    else state = 'MISSING';
    const lateMinutes = r?.checkIn && window ? Math.max(0, minutesBetween(window.start, r.checkIn)) : 0;
    return {
      employeeId: id,
      employeeCode: e.employeeCode,
      name: `${e.firstName || ''} ${e.lastName || ''}`.trim(),
      department: e.department || '',
      designation: e.designation || '',
      workLocation: e.workLocation,
      hasPhone: Boolean(e.phone),
      state,
      checkIn: r?.checkIn,
      checkOut: r?.checkOut,
      lateMinutes: lateMinutes > Number(shift?.graceMinutes || 0) ? lateMinutes : 0,
      workedMinutes: r?.checkIn ? minutesBetween(r.checkIn, r.checkOut || (key === dateKey(today) ? now : r.checkIn)) : 0,
      source: r?.source || '',
      siteName: r?.location?.siteName || '',
      leaveType: leave ? (leave.requestType === 'WFH' ? 'WFH' : leave.leaveType) : '',
      holidayName: holiday?.name || '',
      shiftName: shift?.name || '',
      shiftStart: shift?.startTime || '',
      shiftEnd: shift?.endTime || ''
    };
  });
  const tally = (states) => out.filter((x) => states.includes(x.state)).length;
  res.json({
    date: key,
    isToday: key === dateKey(today),
    summary: {
      total: out.length,
      in: tally(['IN']),
      done: tally(['DONE']),
      present: tally(['IN', 'DONE']),
      late: out.filter((x) => x.lateMinutes > 0).length,
      onLeave: tally(['LEAVE']),
      wfh: tally(['WFH']),
      off: tally(['HOLIDAY', 'WEEK_OFF']),
      notYet: tally(['NOT_YET']),
      missing: tally(['MISSING', 'ABSENT'])
    },
    rows: out
  });
});

async function getMobileAttendanceContext(req) {
  const employee = await getOwnEmployee(req);
  const now = new Date();
  const resolved = await resolveAttendanceDateForPunch({
    tenantId: req.tenantId,
    employeeId: employee._id,
    timestamp: now
  });
  const resolvedDate = startOfDay(resolved.attendanceDate || now);
  // Close anything past its deadline BEFORE deciding what this punch means.
  // Without this a forgotten check-out from yesterday would still be offered
  // today, and the morning check-in would be written as yesterday's check-out.
  // Today's record is read at the same time (it was always read before the
  // close), which saves one trip to the database.
  let [attendance] = await Promise.all([
    Attendance.findOne({
      tenantId: req.tenantId,
      employeeId: employee._id,
      date: resolvedDate
    }),
    autoCloseStalePunches({ tenantId: req.tenantId, employeeId: employee._id, now })
  ]);

  // Overnight shifts legitimately check out after midnight, so an open record
  // from the previous duty date is still offered — but only while it is inside
  // its own shift-end + grace window.
  if (!attendance || (!attendance.checkIn && !attendance.checkOut)) {
    const openFrom = new Date(now.getTime() - (36 * 60 * 60 * 1000));
    const openAttendance = await Attendance.findOne({
      tenantId: req.tenantId,
      employeeId: employee._id,
      checkIn: { $exists: true, $ne: null },
      $or: [{ checkOut: null }, { checkOut: { $exists: false } }],
      autoClosed: { $ne: true },
      date: { $gte: startOfDay(openFrom), $lte: startOfDay(now) }
    }).sort('-date');
    if (openAttendance) {
      const policy = await getPolicy(req.tenantId);
      const stillOpen = await isStillOpenForCheckout({
        tenantId: req.tenantId, employeeId: employee._id, attendance: openAttendance, policy, now
      });
      if (stillOpen) attendance = openAttendance;
    }
  }

  const canCheckIn = !attendance?.checkIn && !attendance?.checkOut;
  const canCheckOut = Boolean(attendance?.checkIn && !attendance?.checkOut);
  const completed = Boolean(attendance?.checkIn && attendance?.checkOut);

  return {
    employee,
    now,
    resolved,
    attendanceDate: attendance?.date || resolvedDate,
    attendance,
    canCheckIn,
    canCheckOut,
    completed
  };
}

async function mobileMark(req, mode) {
  const { lat, lng, address } = req.body;
  const latNumber = Number(lat);
  const lngNumber = Number(lng);
  if (!Number.isFinite(latNumber) || !Number.isFinite(lngNumber)) {
    throw new ApiError(400, 'Valid latitude and longitude are required');
  }

  const context = await getMobileAttendanceContext(req);
  const { employee, now, attendanceDate, attendance: current } = context;
  const tenant = await Tenant.findById(req.tenantId);
  const point = { lat: latNumber, lng: lngNumber };
  let source = 'MOBILE_GEOFENCE';
  let site = null;

  if (employee.canUseAnywhereAttendance) {
    source = 'ANYWHERE';
  } else if (employee.canUseGeofencing) {
    site = findAllowedSite(point, tenant.sites);
    if (!site) throw new ApiError(400, 'You are outside the allowed geofence');
  } else {
    const todayWfh = await LeaveRequest.findOne({
      tenantId: req.tenantId,
      employeeId: employee._id,
      requestType: 'WFH',
      status: 'APPROVED',
      fromDate: { $lte: endOfDay(now) },
      toDate: { $gte: startOfDay(now) }
    });
    if (!todayWfh) throw new ApiError(403, 'Mobile attendance is not enabled for this employee');
    source = 'WFH';
  }

  if (mode === 'in') {
    if (current?.checkIn || current?.checkOut) {
      throw new ApiError(409, current?.checkOut ? 'Attendance is already completed for this duty day' : 'You are already checked in. Please check out when duty is complete.');
    }
  }

  if (mode === 'out') {
    if (!current?.checkIn) throw new ApiError(400, 'Check-in is required before check-out');
    if (current?.checkOut) throw new ApiError(409, 'You have already checked out for this duty day');
  }

  const location = {
    lat: point.lat,
    lng: point.lng,
    address,
    siteName: site?.name,
    distanceMeters: site?.distanceMeters
  };

  const patch = {
    employeeId: employee._id,
    tenantId: req.tenantId,
    source,
    status: source === 'WFH' ? 'WFH' : 'PRESENT',
    location,
    meta: {
      ...(current?.meta || {}),
      mobile: {
        ...(current?.meta?.mobile || {}),
        ...(mode === 'in'
          ? { checkInLocation: location, checkInCapturedAt: now }
          : { checkOutLocation: location, checkOutCapturedAt: now })
      }
    }
  };

  if (mode === 'in') patch.checkIn = now;
  if (mode === 'out') {
    patch.checkIn = current.checkIn;
    patch.checkOut = now;
  }

  return upsertAttendance({
    tenantId: req.tenantId,
    employeeId: employee._id,
    date: attendanceDate,
    patch
  });
}

exports.mobileState = asyncHandler(async (req, res) => {
  const context = await getMobileAttendanceContext(req);
  // v26: the punch card also shows the duty shift, live late minutes and worked time.
  const policy = await getPolicy(req.tenantId);
  const offset = resolveTimezoneOffset(policy);
  const day = startOfDay(context.attendanceDate);
  const assignment = await ShiftAssignment.findOne({
    tenantId: req.tenantId,
    employeeId: context.employee._id,
    fromDate: { $lte: day },
    $or: [{ toDate: null }, { toDate: { $exists: false } }, { toDate: { $gte: day } }]
  }).populate('shiftId').sort('-fromDate');
  const shift = assignment?.shiftId || await Shift.findOne({ tenantId: req.tenantId, active: true }).sort('createdAt');
  const window = shift ? computeShiftWindow(shift, day, offset) : null;
  const record = context.attendance;
  const lateMinutes = record?.checkIn && window ? Math.max(0, minutesBetween(window.start, record.checkIn)) : 0;
  const workedMinutes = record?.checkIn ? minutesBetween(record.checkIn, record.checkOut || new Date()) : 0;
  const employee = context.employee;
  res.json({
    shift: shift ? { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, graceMinutes: shift.graceMinutes || 0, durationMinutes: window?.durationMinutes || 0, weeklyOffDays: shift.weeklyOffDays || [] } : null,
    window: window ? { start: window.start, end: window.end } : null,
    lateMinutes: lateMinutes > Number(shift?.graceMinutes || 0) ? lateMinutes : 0,
    workedMinutes,
    mobile: {
      enabled: Boolean(employee.canUseAnywhereAttendance || employee.canUseGeofencing),
      mode: employee.canUseAnywhereAttendance ? 'ANYWHERE' : employee.canUseGeofencing ? 'GEOFENCE' : (employee.canApplyWfh ? 'WFH_ONLY' : 'BIOMETRIC'),
      canApplyWfh: Boolean(employee.canApplyWfh)
    },
    date: dateKey(context.attendanceDate),
    attendance: context.attendance,
    canCheckIn: context.canCheckIn,
    canCheckOut: context.canCheckOut,
    completed: context.completed,
    nextAction: context.canCheckIn ? 'CHECK_IN' : context.canCheckOut ? 'CHECK_OUT' : 'DONE',
    autoClosed: Boolean(context.attendance?.autoClosed),
    missingCheckOut: Boolean(context.attendance?.missingCheckOut),
    notice: context.attendance?.missingCheckOut
      ? 'Your last duty day was closed without an out time. Raise a regularization to correct it.'
      : ''
  });
});

exports.mobileCheckIn = asyncHandler(async (req, res) => {
  const attendance = await mobileMark(req, 'in');
  const employee = await getOwnEmployee(req);
  res.status(201).json({
    attendance,
    message: punchMessage({ mode: 'in', now: new Date(), employeeName: employee?.firstName })
  });
});

exports.mobileCheckOut = asyncHandler(async (req, res) => {
  const attendance = await mobileMark(req, 'out');
  const employee = await getOwnEmployee(req);
  res.status(201).json({
    attendance,
    message: punchMessage({ mode: 'out', now: new Date(), employeeName: employee?.firstName })
  });
});

exports.importBiometric = asyncHandler(async (req, res) => {
  const { logs = [] } = req.body;
  const result = await importBiometricLogs({ tenantId: req.tenantId, logs });
  res.json(result);
});

exports.overrideAttendance = asyncHandler(async (req, res) => {
  const { employeeId, date, checkIn, checkOut, status, dayPart, lateMinutes, earlyLeaveMinutes, lopDays, remarks, overrideCategory } = req.body;
  if (!remarks) throw new ApiError(400, 'Override remarks are required');
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(date || ''))) throw new ApiError(400, 'date must be YYYY-MM-DD');
  // v26: datetime-local values ("2026-08-12T10:00") carry no zone and were read
  // in the SERVER's zone — UTC on Render — so a 10:00 correction was stored as
  // 15:30 IST and produced 5½ hours of phantom late-in. Zone-less values are
  // now company time; "HH:mm" alone is taken on the corrected date.
  const policy = await getPolicy(req.tenantId);
  const offset = resolveTimezoneOffset(policy);
  const parsedCheckIn = parseCompanyDateTime(checkIn, offset, { baseDate: String(date).slice(0, 10) });
  const parsedCheckOut = parseCompanyDateTime(checkOut, offset, { baseDate: String(date).slice(0, 10) });
  if (parsedCheckIn === null) throw new ApiError(400, 'Invalid check-in time');
  if (parsedCheckOut === null) throw new ApiError(400, 'Invalid check-out time');
  if (parsedCheckIn && parsedCheckOut && parsedCheckOut <= parsedCheckIn && !['ABSENT', 'WEEK_OFF', 'HOLIDAY', 'LEAVE'].includes(status)) {
    throw new ApiError(400, 'Check-out must be later than check-in for a worked attendance status');
  }
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  if (!allowed.includes(String(employeeId))) throw new ApiError(403, 'Employee attendance is outside your permitted Office / Factory scope');
  const employee = await Employee.findOne({ _id: employeeId, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  const attendance = await upsertAttendance({
    tenantId: req.tenantId,
    employeeId,
    date,
    evaluate: false,
    patch: {
      checkIn: parsedCheckIn,
      checkOut: parsedCheckOut,
      status: status || 'PRESENT',
      dayPart: dayPart || 'FULL',
      source: 'OVERRIDE',
      lateMinutes: Number(lateMinutes || 0),
      earlyLeaveMinutes: Number(earlyLeaveMinutes || 0),
      lopDays: Number(lopDays || 0),
      lopOverride: { enabled: true, originalLopDays: 0, overrideLopDays: Number(lopDays || 0), reason: remarks, category: overrideCategory || 'OTHER', overriddenBy: req.user._id, overriddenAt: new Date() },
      deductionReason: remarks,
      overrideRemarks: remarks,
      overrideBy: req.user._id,
      evaluatedAt: new Date()
    }
  });
  await RuleAudit.create({ tenantId: req.tenantId, module: 'ATTENDANCE', action: 'ATTENDANCE_OVERRIDE', targetId: String(attendance._id), after: attendance.toObject(), reason: remarks, changedBy: req.user._id });
  res.json({ attendance });
});

exports.overrideLop = asyncHandler(async (req, res) => {
  const { attendanceId, employeeId, date, lopDays = 0, reason, category = 'SPECIAL', status } = req.body;
  if (!reason) throw new ApiError(400, 'Reason is required for LOP override');
  let attendance;
  if (attendanceId) attendance = await Attendance.findOne({ _id: attendanceId, tenantId: req.tenantId });
  else if (employeeId && date) attendance = await Attendance.findOne({ tenantId: req.tenantId, employeeId, date: startOfDay(date) });
  if (!attendance) throw new ApiError(404, 'Attendance record not found');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  if (!allowed.includes(String(attendance.employeeId))) throw new ApiError(403, 'Attendance record is outside your permitted Office / Factory scope');
  const before = attendance.toObject();
  attendance.lopOverride = { enabled: true, originalLopDays: Number(attendance.lopDays || 0), overrideLopDays: Number(lopDays || 0), reason, category, overriddenBy: req.user._id, overriddenAt: new Date() };
  attendance.lopDays = Number(lopDays || 0);
  if (status) attendance.status = status;
  attendance.overrideRemarks = reason;
  attendance.deductionReason = `LOP override: ${reason}`;
  attendance.overrideBy = req.user._id;
  await attendance.save();
  await RuleAudit.create({ tenantId: req.tenantId, module: 'ATTENDANCE', action: 'LOP_OVERRIDE', targetId: String(attendance._id), before, after: attendance.toObject(), reason, changedBy: req.user._id });
  res.json({ attendance });
});

exports.evaluateMonth = asyncHandler(async (req, res) => {
  const month = req.body.month || req.query.month;
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new ApiError(400, 'month must be YYYY-MM');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const rows = await evaluateMonth({ tenantId: req.tenantId, employeeIds: allowed, month });
  res.json({ evaluated: rows.length, attendance: rows });
});
