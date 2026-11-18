const asyncHandler = require('../utils/asyncHandler');
const { hasAbility } = require('../middleware/auth');
const ApiError = require('../utils/apiError');
const Regularization = require('../models/Regularization');
const PermissionRequest = require('../models/PermissionRequest');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { startOfDay, companyToday, parseCompanyDateTime } = require('../utils/date');
const { resolveTimezoneOffset } = require('../utils/shift');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { canApproveEmployee, getReportingManager } = require('../services/approvalService');
const { notifyUser, notifyEmployee, notifyRoles } = require('../services/inAppNotificationService');
const { notifyLater, recipientsForRoles } = require('../services/messaging/dispatcher');
const { evaluateAttendanceRecord, getPolicy } = require('../services/attendanceRulesService');

async function resolveRequestEmployee(req, input = req.body || {}) {
  const { employeeId, employeeCode } = input;
  if (!employeeId && !employeeCode) {
    if (!req.employee) throw new ApiError(400, 'No employee profile linked');
    return { employee: req.employee, appliedOnBehalf: false };
  }
  const employee = await Employee.findOne({ tenantId: req.tenantId, ...(employeeId ? { _id: employeeId } : { employeeCode }) });
  if (!employee) throw new ApiError(404, 'Employee not found for on-behalf regularization');
  const isSelf = Boolean(req.employee && String(req.employee._id) === String(employee._id));
  if (isSelf) return { employee, appliedOnBehalf: false };
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  if (!allowed.map(String).includes(String(employee._id))) throw new ApiError(403, 'This employee is outside your allowed Office / Factory scope');
  // Reporting managers may correct their own team's attendance, like leave.
  const permitted = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)
    || hasAbility(req.user, 'REGULARIZATION', 'APPLY_ON_BEHALF')
    || await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: employee });
  if (!permitted) throw new ApiError(403, 'You do not have permission to apply on behalf of this employee');
  return { employee, appliedOnBehalf: true };
}

/** Same rule as leave: an approver applying for someone is the approval. */
async function submitterCanApprove(req, employee, appliedOnBehalf) {
  if (!appliedOnBehalf) return req.user.role === 'SUPER_ADMIN';
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) return true;
  if (hasAbility(req.user, 'REGULARIZATION', 'APPROVE')) return true;
  return canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: employee });
}

/** Writes an approved correction / permission onto the attendance record. */
async function applyApprovedRegularization(req, request) {
  const employeeId = request.employeeId?._id || request.employeeId;
  if (request.requestType === 'ATTENDANCE_CORRECTION') {
    const update = {
      status: 'PRESENT',
      source: 'OVERRIDE',
      overrideRemarks: `Regularized: ${request.reason || ''}`,
      overrideBy: req.user._id,
      regularizationId: request._id
    };
    if (request.requestedCheckIn) update.checkIn = request.requestedCheckIn;
    if (request.requestedCheckOut) update.checkOut = request.requestedCheckOut;
    const attendance = await Attendance.findOneAndUpdate(
      { tenantId: req.tenantId, employeeId, date: startOfDay(request.date) },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await evaluateAttendanceRecord(attendance);
  } else {
    // LATE_IN / EARLY_LEAVE / MEDICAL / SPECIAL are permissions inside the
    // same Regularization workflow. They never rewrite the employee's punches.
    await reevaluatePermissionDay({ req, employeeId, date: request.date });
  }
}

function legacyPermissionToRegularization(permission) {
  const obj = permission.toObject ? permission.toObject() : permission;
  return {
    ...obj,
    requestType: obj.type,
    legacyPermission: true,
    source: 'LEGACY_PERMISSION'
  };
}

async function assertDecisionAccess(req, targetEmployee) {
  if (req.employee && String(req.employee._id) === String(targetEmployee?._id || targetEmployee) && req.user.role !== 'SUPER_ADMIN') {
    throw new ApiError(403, 'You cannot decide your own attendance request. It goes to your reporting manager or HR.');
  }
  const visible = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  if (!visible.map(String).includes(String(targetEmployee?._id || targetEmployee))) {
    throw new ApiError(403, 'This employee is outside your allowed attendance scope');
  }
  const allowed = hasAbility(req.user, 'REGULARIZATION', 'APPROVE')
    || await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee });
  if (!allowed) throw new ApiError(403, 'Only reporting manager, HR/admin, or an explicitly permitted approver can decide this request');
}

exports.list = asyncHandler(async (req, res) => {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const [regularizations, legacyPermissions] = await Promise.all([
    Regularization.find({ tenantId: req.tenantId, employeeId: { $in: allowed } })
      .populate('employeeId', 'employeeCode firstName lastName department workLocation reportsTo')
      .sort('-createdAt'),
    PermissionRequest.find({ tenantId: req.tenantId, employeeId: { $in: allowed } })
      .populate('employeeId', 'employeeCode firstName lastName department workLocation reportsTo')
      .sort('-createdAt')
  ]);
  const requests = [
    ...regularizations.map((request) => ({ ...request.toObject(), legacyPermission: false, source: 'REGULARIZATION' })),
    ...legacyPermissions.map(legacyPermissionToRegularization)
  ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json({ requests, unified: true });
});

/**
 * The single path that creates a correction / permission request (form, HR
 * day drawer, AI copilot). Approvers applying on someone's behalf get it
 * approved immediately unless they ask for `sendForApproval`.
 */
async function submitRegularization(req, input = {}) {
  const { employee, appliedOnBehalf } = await resolveRequestEmployee(req, input);
  const {
    date,
    requestedCheckIn,
    requestedCheckOut,
    reason,
    requestType = 'ATTENDANCE_CORRECTION',
    requestedMinutes = 0,
    attachmentUrl = ''
  } = input;
  if (!date) throw new ApiError(400, 'Date is required');
  if (!['ATTENDANCE_CORRECTION', 'LATE_IN', 'EARLY_LEAVE', 'MEDICAL', 'SPECIAL'].includes(requestType)) {
    throw new ApiError(400, 'Invalid regularization / permission type');
  }
  if (requestType === 'ATTENDANCE_CORRECTION' && !requestedCheckIn && !requestedCheckOut) {
    throw new ApiError(400, 'Provide the corrected check-in and/or check-out time');
  }
  const dayKey = String(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new ApiError(400, 'Date must be YYYY-MM-DD');
  const day = startOfDay(new Date(`${dayKey}T00:00:00.000Z`));
  if (day > companyToday()) throw new ApiError(400, 'Attendance can only be corrected for today or a past date');
  // v26: "2026-08-12T10:00" from a datetime-local input has no zone. The server
  // used to read it as UTC, so an approved 10:00 correction became 15:30 IST and
  // the employee was charged 5½ hours late. Zone-less values are company time.
  const offset = resolveTimezoneOffset(await getPolicy(req.tenantId));
  const checkIn = parseCompanyDateTime(requestedCheckIn, offset, { baseDate: dayKey });
  const checkOut = parseCompanyDateTime(requestedCheckOut, offset, { baseDate: dayKey });
  if (checkIn === null) throw new ApiError(400, 'Corrected check-in time is not valid');
  if (checkOut === null) throw new ApiError(400, 'Corrected check-out time is not valid');
  if (checkIn && checkOut && checkOut <= checkIn) throw new ApiError(400, 'Corrected check-out must be after check-in');
  const autoApprove = input.sendForApproval === true ? false : await submitterCanApprove(req, employee, appliedOnBehalf);
  const duplicate = await Regularization.findOne({ tenantId: req.tenantId, employeeId: employee._id, date: day, requestType, status: 'PENDING' });
  if (duplicate && !autoApprove) throw new ApiError(409, 'A request of this type is already pending for this date. Wait for a decision or ask your approver.');
  const employeeName = `${employee.firstName} ${employee.lastName || ''}`.trim();
  const who = req.user.name || 'HR';
  if (duplicate) {
    // The approver's own entry replaces the employee's pending one for that day.
    duplicate.status = 'REJECTED';
    duplicate.decidedBy = req.user._id;
    duplicate.decidedAt = new Date();
    duplicate.decisionRemarks = `Replaced by a correction recorded by ${who}`;
    await duplicate.save();
  }
  const request = await Regularization.create({
    tenantId: req.tenantId,
    employeeId: employee._id,
    date: day,
    requestedCheckIn: checkIn,
    requestedCheckOut: checkOut,
    reason,
    requestType,
    requestedMinutes,
    attachmentUrl,
    appliedByUserId: req.user._id,
    appliedOnBehalf,
    ...(autoApprove ? {
      status: 'APPROVED',
      decidedBy: req.user._id,
      decidedAt: new Date(),
      decisionRemarks: appliedOnBehalf ? `Recorded on behalf of the employee and approved by ${who}` : 'Approved automatically: applied by the Super Admin'
    } : {})
  });

  if (autoApprove) {
    await applyApprovedRegularization(req, request);
    notifyLater({
      tenantId: req.tenantId,
      event: 'REGULARIZATION_DECIDED',
      recipients: [{ employeeId: employee._id }],
      path: '/regularization',
      entityId: `${request._id}:APPROVED`,
      actorUserId: req.user._id,
      data: { date: request.date, status: 'APPROVED', decidedBy: who, remarks: appliedOnBehalf ? `Recorded for you by ${who}` : '' },
      inApp: {
        type: 'ATTENDANCE_REQUEST_APPROVED',
        title: 'Attendance corrected',
        body: appliedOnBehalf ? `${who} corrected your attendance for ${new Date(request.date).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' })}. No action needed.` : 'Your attendance correction is approved.',
        entityType: 'REGULARIZATION'
      }
    });
    return { request, employee, autoApproved: true, appliedOnBehalf, employeeName };
  }

  const manager = await getReportingManager(employee);
  notifyLater({
    tenantId: req.tenantId,
    event: 'REGULARIZATION_SUBMITTED',
    recipients: manager?.userId?._id ? [{ userId: manager.userId._id, employeeId: manager._id }] : await recipientsForRoles(req.tenantId, ['SUPER_ADMIN', 'HR_ADMIN']),
    path: '/regularization',
    entityId: request._id,
    actorUserId: req.user._id,
    data: { employeeName, employeeCode: employee.employeeCode, date: request.date, requestType, checkIn: request.requestedCheckIn, checkOut: request.requestedCheckOut, reason: request.reason },
    inApp: {
      type: 'ATTENDANCE_REQUEST',
      title: 'New attendance correction request',
      body: `${employeeName} submitted ${String(requestType).replaceAll('_', ' ').toLowerCase()} for ${new Date(date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
      entityType: 'REGULARIZATION',
      priority: 'HIGH'
    }
  });

  return { request, employee, autoApproved: false, appliedOnBehalf, employeeName };
}

exports.submitRegularization = submitRegularization;

exports.apply = asyncHandler(async (req, res) => {
  const { request, autoApproved, appliedOnBehalf, employeeName } = await submitRegularization(req, req.body || {});
  const message = autoApproved
    ? (appliedOnBehalf ? `Approved. ${employeeName}'s attendance is updated.` : 'Approved. Your attendance is updated.')
    : 'Request sent for approval';
  res.status(201).json({ request, unified: true, autoApproved, message });
});

async function reevaluatePermissionDay({ req, employeeId, date }) {
  const attendance = await Attendance.findOne({ tenantId: req.tenantId, employeeId, date: startOfDay(date) });
  if (attendance) await evaluateAttendanceRecord(attendance);
  return attendance;
}

exports.decision = asyncHandler(async (req, res) => {
  const { status, remarks } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) throw new ApiError(400, 'status must be APPROVED or REJECTED');

  let request = await Regularization.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('employeeId');
  if (request) {
    await assertDecisionAccess(req, request.employeeId);
    if (request.status !== 'PENDING') throw new ApiError(400, 'Request already decided');
    request.status = status;
    request.decidedBy = req.user._id;
    request.decidedAt = new Date();
    request.decisionRemarks = remarks;
    await request.save();

    if (status === 'APPROVED') await applyApprovedRegularization(req, request);
    notifyLater({
      tenantId: req.tenantId,
      event: 'REGULARIZATION_DECIDED',
      recipients: [{ employeeId: request.employeeId._id }],
      path: '/regularization',
      entityId: `${request._id}:${status}`,
      actorUserId: req.user._id,
      data: { date: request.date, status, decidedBy: req.user.name, remarks: remarks || '' },
      inApp: {
        type: status === 'APPROVED' ? 'ATTENDANCE_REQUEST_APPROVED' : 'ATTENDANCE_REQUEST_REJECTED',
        title: `Attendance request ${status.toLowerCase()}`,
        body: remarks || `Your ${String(request.requestType).replaceAll('_', ' ').toLowerCase()} request was ${status.toLowerCase()}.`,
        entityType: 'REGULARIZATION',
        priority: status === 'REJECTED' ? 'HIGH' : 'NORMAL'
      }
    });
    return res.json({ request: { ...request.toObject(), legacyPermission: false }, unified: true, message: `Attendance request ${status.toLowerCase()}` });
  }

  // Backward compatibility: old PermissionRequest records remain visible and
  // decidable inside the merged Regularization screen. No destructive migration is required.
  const legacy = await PermissionRequest.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('employeeId');
  if (!legacy) throw new ApiError(404, 'Regularization / permission request not found');
  await assertDecisionAccess(req, legacy.employeeId);
  if (legacy.status !== 'PENDING') throw new ApiError(400, 'Request already decided');
  legacy.status = status;
  legacy.decidedBy = req.user._id;
  legacy.decidedAt = new Date();
  legacy.decisionRemarks = remarks;
  if (['MEDICAL', 'SPECIAL'].includes(legacy.type)) legacy.countedInMonthlyLimit = false;
  await legacy.save();
  if (status === 'APPROVED') await reevaluatePermissionDay({ req, employeeId: legacy.employeeId._id, date: legacy.date });
  await notifyEmployee({
    tenantId: req.tenantId,
    employeeId: legacy.employeeId._id,
    actorUserId: req.user._id,
    type: status === 'APPROVED' ? 'ATTENDANCE_REQUEST_APPROVED' : 'ATTENDANCE_REQUEST_REJECTED',
    title: `Attendance permission ${status.toLowerCase()}`,
    body: remarks || `Your ${String(legacy.type || 'permission').replaceAll('_', ' ').toLowerCase()} request was ${status.toLowerCase()}.`,
    link: '/regularization',
    entityType: 'PERMISSION_REQUEST',
    entityId: legacy._id,
    priority: status === 'REJECTED' ? 'HIGH' : 'NORMAL'
  });
  res.json({ request: legacyPermissionToRegularization(legacy), unified: true, message: `Attendance permission ${status.toLowerCase()}` });
});
