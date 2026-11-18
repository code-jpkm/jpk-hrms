const Employee = require('../models/Employee');

async function getReportingManager(employee) {
  if (!employee?.reportsTo) return null;
  return Employee.findOne({ _id: employee.reportsTo, tenantId: employee.tenantId }).populate('userId');
}

async function canApproveEmployee({ user, employee: actingEmployee, targetEmployee }) {
  if (!user || !targetEmployee) return false;
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role)) return true;
  if (!actingEmployee?._id) return false;
  let current = targetEmployee.reportsTo ? String(targetEmployee.reportsTo) : null;
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === String(actingEmployee._id)) return true;
    visited.add(current);
    const manager = await Employee.findOne({ _id: current, tenantId: targetEmployee.tenantId }).select('reportsTo');
    current = manager?.reportsTo ? String(manager.reportsTo) : null;
  }
  return false;
}

module.exports = { getReportingManager, canApproveEmployee };
