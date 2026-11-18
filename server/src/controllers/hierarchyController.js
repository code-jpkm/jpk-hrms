const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Employee = require('../models/Employee');
const { normalizeObjectId, ensureManagerAssignmentIsValid } = require('../utils/hierarchy');

function buildTree(employees) {
  const byId = new Map();
  const roots = [];
  employees.forEach((e) => byId.set(String(e._id), { ...e.toObject(), children: [] }));
  byId.forEach((node) => {
    const parentId = node.reportsTo ? String(node.reportsTo._id || node.reportsTo) : null;
    if (parentId && byId.has(parentId) && parentId !== String(node._id)) byId.get(parentId).children.push(node);
    else roots.push(node);
  });
  return roots;
}

exports.tree = asyncHandler(async (req, res) => {
  const employees = await Employee.find({ tenantId: req.tenantId, status: { $ne: 'OFFBOARDED' } }).populate('reportsTo', 'employeeCode firstName lastName designation').sort('employeeCode');
  res.json({ employees, tree: buildTree(employees) });
});

exports.updateManager = asyncHandler(async (req, res) => {
  const { employeeId } = req.body;
  const reportsTo = normalizeObjectId(req.body.reportsTo);
  const employee = await Employee.findOne({ _id: employeeId, tenantId: req.tenantId });
  if (!employee) throw new ApiError(404, 'Employee not found');
  employee.reportsTo = reportsTo ? await ensureManagerAssignmentIsValid({ tenantId: req.tenantId, employeeId: employee._id, reportsTo }) : undefined;
  await employee.save();
  res.json({ employee });
});
