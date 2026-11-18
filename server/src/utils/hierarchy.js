const ApiError = require('./apiError');
const Employee = require('../models/Employee');

function normalizeObjectId(value) {
  if (!value) return undefined;
  if (typeof value === 'object' && value._id) return value._id;
  const str = String(value).trim();
  return str || undefined;
}

async function ensureManagerAssignmentIsValid({ tenantId, employeeId, reportsTo }) {
  const managerId = normalizeObjectId(reportsTo);
  if (!managerId) return undefined;
  if (String(employeeId) === String(managerId)) throw new ApiError(400, 'Employee cannot report to self');
  const manager = await Employee.findOne({ _id: managerId, tenantId }).select('_id reportsTo employeeCode firstName lastName');
  if (!manager) throw new ApiError(404, 'Reporting manager not found');

  let current = manager.reportsTo ? String(manager.reportsTo) : null;
  const visited = new Set([String(manager._id)]);
  while (current) {
    if (String(current) === String(employeeId)) {
      throw new ApiError(400, 'Cannot assign reporting manager because it creates a circular hierarchy');
    }
    if (visited.has(String(current))) {
      throw new ApiError(400, 'Cannot assign reporting manager because the existing hierarchy already has a cycle');
    }
    visited.add(String(current));
    const parent = await Employee.findOne({ _id: current, tenantId }).select('_id reportsTo');
    current = parent?.reportsTo ? String(parent.reportsTo) : null;
  }
  return managerId;
}

module.exports = { normalizeObjectId, ensureManagerAssignmentIsValid };
