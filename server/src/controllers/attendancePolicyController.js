const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const AttendancePolicy = require('../models/AttendancePolicy');
const RuleAudit = require('../models/RuleAudit');
const { getPolicy, evaluateMonth } = require('../services/attendanceRulesService');
const { getScopedEmployeeIds } = require('../services/scopeService');

exports.getPolicy = asyncHandler(async (req, res) => {
  const policy = await getPolicy(req.tenantId);
  res.json({ policy });
});

exports.savePolicy = asyncHandler(async (req, res) => {
  const before = await AttendancePolicy.findOne({ tenantId: req.tenantId }).lean();
  const policy = await AttendancePolicy.findOneAndUpdate(
    { tenantId: req.tenantId },
    { ...req.body, tenantId: req.tenantId, active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await RuleAudit.create({ tenantId: req.tenantId, module: 'ATTENDANCE', action: 'SAVE_ATTENDANCE_POLICY', before, after: policy.toObject(), reason: req.body.changeReason || 'Manual attendance rule change', changedBy: req.user._id });
  res.json({ policy });
});

exports.evaluateMonth = asyncHandler(async (req, res) => {
  const month = req.body.month || req.query.month;
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new ApiError(400, 'month must be YYYY-MM');
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' });
  const employeeIds = req.body.employeeIds?.length ? req.body.employeeIds.filter((id) => allowed.includes(String(id))) : allowed;
  const rows = await evaluateMonth({ tenantId: req.tenantId, employeeIds, month });
  res.json({ evaluated: rows.length, attendance: rows });
});
