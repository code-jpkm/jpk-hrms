const Employee = require('../models/Employee');
const AccessGrant = require('../models/AccessGrant');

async function descendantIds(managerEmployeeId, tenantId) {
  if (!managerEmployeeId) return [];
  const result = [];
  const queue = [String(managerEmployeeId)];
  while (queue.length) {
    const current = queue.shift();
    const children = await Employee.find({ tenantId, reportsTo: current }).select('_id');
    for (const child of children) {
      const id = String(child._id);
      if (!result.includes(id)) {
        result.push(id);
        queue.push(id);
      }
    }
  }
  return result;
}

function mapResource(resource) {
  const key = String(resource || '').toUpperCase();
  if (key === 'PAYROLL') return 'SALARY';
  return key;
}

async function getScopedEmployeeIds({ user, employee, resource }) {
  const tenantId = user.tenantId;
  const normalized = mapResource(resource);
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role)) {
    const employees = await Employee.find({ tenantId }).select('_id');
    return employees.map((e) => String(e._id));
  }

  const grant = await AccessGrant.findOne({ tenantId, viewerUserId: user._id, resource: normalized });

  // An explicit AccessGrant overrides the default manager-tree visibility. This
  // makes BOTH / OFFICE / FACTORY / SELECTED behave exactly as configured by HR.
  // The signed-in employee always keeps access to their own record.
  if (grant) {
    const ids = new Set();
    if (employee?._id) ids.add(String(employee._id));

    if (grant.canViewAll) {
      const locationFilter = grant.workLocations?.length
        ? { workLocation: { $in: [...grant.workLocations, 'BOTH'] } }
        : {};
      const employees = await Employee.find({ tenantId, ...locationFilter }).select('_id');
      employees.forEach((item) => ids.add(String(item._id)));
      return Array.from(ids);
    }

    if (grant.employeeIds?.length) grant.employeeIds.forEach((id) => ids.add(String(id)));
    if (grant.workLocations?.length) {
      const locationEmployees = await Employee.find({ tenantId, workLocation: { $in: [...grant.workLocations, 'BOTH'] } }).select('_id');
      locationEmployees.forEach((item) => ids.add(String(item._id)));
    }
    return Array.from(ids);
  }

  // No explicit scope configured: employee sees self; managers additionally see
  // their reporting hierarchy. This preserves the normal default manager flow.
  const ids = new Set();
  if (employee?._id) ids.add(String(employee._id));
  if (user.role === 'MANAGER' && employee?._id) {
    const descendants = await descendantIds(employee._id, tenantId);
    descendants.forEach((id) => ids.add(String(id)));
  }
  return Array.from(ids);
}

async function assertEmployeeVisible({ req, employeeId, resource }) {
  const allowed = await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource });
  return allowed.includes(String(employeeId));
}

module.exports = { getScopedEmployeeIds, assertEmployeeVisible, descendantIds };
