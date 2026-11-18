const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const PermissionRequest = require('../models/PermissionRequest');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { startOfDay, monthRange } = require('../utils/date');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { getReportingManager, canApproveEmployee } = require('../services/approvalService');
const { notifyLater } = require('../services/messaging/dispatcher');
const { evaluateAttendanceRecord, getPolicy } = require('../services/attendanceRulesService');

async function countMonthly(employee, date) {
  const d = new Date(date);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { from, to } = monthRange(month);
  return PermissionRequest.countDocuments({ tenantId: employee.tenantId, employeeId: employee._id, countedInMonthlyLimit: true, type: { $in: ['LATE_IN', 'EARLY_LEAVE'] }, status: { $in: ['PENDING', 'APPROVED'] }, date: { $gte: from, $lte: to } });
}

async function resolveRequestEmployee(req) {
  const { employeeId, employeeCode } = req.body;
  if (!employeeId && !employeeCode) {
    if (!req.employee) throw new ApiError(400, 'No employee profile linked');
    return { employee: req.employee, appliedOnBehalf: false };
  }
  if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) throw new ApiError(403, 'Only HR/Admin can apply on behalf of employees');
  const employee = await Employee.findOne({ tenantId: req.tenantId, ...(employeeId ? { _id: employeeId } : { employeeCode }) });
  if (!employee) throw new ApiError(404, 'Employee not found for on-behalf request');
  return { employee, appliedOnBehalf: !(req.employee && String(req.employee._id) === String(employee._id)) };
}

async function findAdminApprover(tenantId) {
  const user = await User.findOne({ tenantId, status: 'ACTIVE', role: { $in: ['HR_ADMIN', 'SUPER_ADMIN'] } }).sort({ role: 1, createdAt: 1 });
  if (!user) return null;
  return Employee.findOne({ tenantId, userId: user._id }).populate('userId');
}

function assertAdminDecision(req) {
  if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) throw new ApiError(403, 'Only HR/Admin can approve or reject late-in, early-leave, medical and special permissions');
}

exports.list = asyncHandler(async (req, res) => {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const q = { tenantId: req.tenantId, employeeId: { $in: allowed } };
  if (req.query.status) q.status = req.query.status;
  if (req.query.type) q.type = req.query.type;
  const requests = await PermissionRequest.find(q).populate('employeeId', 'employeeCode firstName lastName department reportsTo').populate('approverEmployeeId', 'employeeCode firstName lastName').sort('-createdAt');
  res.json({ requests });
});

exports.apply = asyncHandler(async (req, res) => {
  const { employee, appliedOnBehalf } = await resolveRequestEmployee(req);
  const { type, date, requestedMinutes, reason, attachmentUrl } = req.body;
  if (!['LATE_IN', 'EARLY_LEAVE', 'MEDICAL', 'SPECIAL'].includes(type)) throw new ApiError(400, 'Invalid permission type');
  const policy = await getPolicy(req.tenantId);
  const countedInMonthlyLimit = ['LATE_IN', 'EARLY_LEAVE'].includes(type);
  if (countedInMonthlyLimit) {
    const used = await countMonthly(employee, date);
    if (used >= policy.permissionLimitPerMonth) throw new ApiError(400, `Only ${policy.permissionLimitPerMonth} combined late-in/early-leave permissions are allowed per month`);
  }
  const adminApprover = await findAdminApprover(req.tenantId);
  const request = await PermissionRequest.create({ tenantId: req.tenantId, employeeId: employee._id, type, date: startOfDay(date), requestedMinutes, reason, attachmentUrl, approverEmployeeId: adminApprover?._id, countedInMonthlyLimit, appliedByUserId: req.user._id, appliedOnBehalf });
  if (adminApprover?.userId) {
    const name = `${employee.firstName} ${employee.lastName || ''}`.trim();
    notifyLater({
      tenantId: req.tenantId,
      event: 'PERMISSION_SUBMITTED',
      recipients: [{ userId: adminApprover.userId._id || adminApprover.userId, employeeId: adminApprover._id }],
      path: '/regularization',
      entityId: request._id,
      actorUserId: req.user._id,
      data: { employeeName: name, type, date: request.date, minutes: requestedMinutes, reason: reason || '' },
      inApp: { type: 'ATTENDANCE_REQUEST', title: 'New permission request', body: `${name} requested ${String(type).replace(/_/g, ' ').toLowerCase()} permission.`, entityType: 'PERMISSION_REQUEST', priority: 'HIGH' }
    });
  }
  res.status(201).json({ request });
});

exports.decision = asyncHandler(async (req, res) => {
  const { status, remarks, hrOverride = false } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) throw new ApiError(400, 'status must be APPROVED or REJECTED');
  const request = await PermissionRequest.findOne({ _id: req.params.id, tenantId: req.tenantId }).populate('employeeId');
  if (!request) throw new ApiError(404, 'Permission request not found');
  assertAdminDecision(req);
  if (request.status !== 'PENDING') throw new ApiError(400, 'Request already decided');
  request.status = status;
  request.decidedBy = req.user._id;
  request.decidedAt = new Date();
  request.decisionRemarks = remarks;
  request.hrOverride = Boolean(hrOverride || ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role));
  if (['MEDICAL', 'SPECIAL'].includes(request.type)) request.countedInMonthlyLimit = false;
  await request.save();
  const attendance = await Attendance.findOne({ tenantId: req.tenantId, employeeId: request.employeeId._id, date: startOfDay(request.date) });
  if (attendance) await evaluateAttendanceRecord(attendance);
  notifyLater({
    tenantId: req.tenantId,
    event: 'REGULARIZATION_DECIDED',
    recipients: [{ employeeId: request.employeeId._id }],
    path: '/regularization',
    entityId: `${request._id}:${status}`,
    actorUserId: req.user._id,
    data: { date: request.date, status, decidedBy: req.user.name, remarks: remarks || '' },
    inApp: { type: status === 'APPROVED' ? 'ATTENDANCE_REQUEST_APPROVED' : 'ATTENDANCE_REQUEST_REJECTED', title: `Permission ${status.toLowerCase()}`, body: remarks || `Your permission request was ${status.toLowerCase()}.`, entityType: 'PERMISSION_REQUEST' }
  });
  res.json({ request });
});
