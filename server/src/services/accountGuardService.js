const ApiError = require('../utils/apiError');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { hasAbility } = require('../middleware/auth');

/**
 * Rules for portal logins shared by the employee, import and recruitment flows.
 *
 * v26: these checks only existed in PATCH /employees/users/:id/permissions, so
 * the employee and recruitment endpoints could demote or disable a Super
 * Admin, reuse an administrator's login for another employee, or mint a
 * SUPER_ADMIN / allowAll account from a request body.
 */
const ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN'];
const PORTAL_ROLES = ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'];

function isAdminRole(role) {
  return ADMIN_ROLES.includes(String(role || '').toUpperCase());
}

/** Validates a portal role and that the actor may hand it out. Returns the normalised role. */
function assertRoleAssignmentAllowed(actor, role) {
  const nextRole = String(role || 'EMPLOYEE').trim().toUpperCase();
  if (!PORTAL_ROLES.includes(nextRole)) throw new ApiError(400, 'Unsupported portal role');
  if (isAdminRole(nextRole) && actor?.role !== 'SUPER_ADMIN') {
    throw new ApiError(403, 'Only Super Admin can assign HR Admin or Super Admin roles');
  }
  return nextRole;
}

/** Administrator logins can only be changed by a Super Admin. */
function assertCanManageAccount(actor, targetUser) {
  if (targetUser && isAdminRole(targetUser.role) && actor?.role !== 'SUPER_ADMIN') {
    throw new ApiError(403, 'Only Super Admin can change an administrator login');
  }
}

/** Normalises an operation-permission template and checks the actor may grant it. */
function sanitizeOperationPermissions(actor, permissions) {
  if (!permissions) return undefined;
  if (!hasAbility(actor, 'ACCESS', 'MANAGE')) throw new ApiError(403, 'Granting operation permissions requires ACCESS:MANAGE');
  const allowAll = Boolean(permissions.allowAll);
  if (allowAll && actor?.role !== 'SUPER_ADMIN') throw new ApiError(403, 'Only Super Admin can grant full access');
  const modules = (Array.isArray(permissions.modules) ? permissions.modules : [])
    .map((m) => ({
      module: String(m?.module || '').trim().toUpperCase(),
      actions: (Array.isArray(m?.actions) ? m.actions : []).map((a) => String(a).trim().toUpperCase()).filter(Boolean)
    }))
    .filter((m) => m.module && m.actions.length);
  if (actor?.role !== 'SUPER_ADMIN' && modules.some((m) => m.module === 'SYSTEM')) {
    throw new ApiError(403, 'Only Super Admin can grant SYSTEM permissions');
  }
  return { allowAll, modules };
}

/**
 * Finds or creates the portal login for an employee without taking
 * over someone else's login.
 *  - an email whose login belongs to another active employee -> 409
 *  - a login of an OFFBOARDED employee moves to the new record (rehire)
 *  - a disabled, unlinked login is re-activated instead of a duplicate insert
 *  - role / permission changes follow assertRoleAssignmentAllowed and
 *    assertCanManageAccount; an admin login is never changed by a non-Super-Admin
 * `role` is an explicit change request; `defaultRole` only applies to a login
 * created here (an existing login is never demoted implicitly).
 */
async function resolveLoginForEmployee({ actor, tenantId, employee, email, phone, name, role, defaultRole, operationPermissions }) {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (!normalizedEmail) return null;
  const requestedRole = role ? assertRoleAssignmentAllowed(actor, role) : null;
  const newUserRole = requestedRole || (defaultRole ? assertRoleAssignmentAllowed(actor, defaultRole) : 'EMPLOYEE');
  let user = await User.findOne({ tenantId, email: normalizedEmail });

  if (!user) {
    return User.create({
      tenantId,
      name: name || normalizedEmail,
      email: normalizedEmail,
      phone,
      role: newUserRole,
      authProvider: 'PASSWORD',
      invitedAt: new Date(),
      ...(operationPermissions ? { operationPermissions } : {})
    });
  }

  const linked = await Employee.findOne({
    tenantId,
    userId: user._id,
    ...(employee?._id ? { _id: { $ne: employee._id } } : {})
  }).select('employeeCode status');
  if (linked && linked.status !== 'OFFBOARDED') {
    throw new ApiError(409, `${normalizedEmail} is already the login of employee ${linked.employeeCode}`);
  }

  const roleChange = Boolean(requestedRole && requestedRole !== user.role);
  const reactivate = user.status !== 'ACTIVE';
  if (roleChange || operationPermissions || reactivate) assertCanManageAccount(actor, user);

  if (linked) await Employee.updateOne({ _id: linked._id, tenantId }, { $unset: { userId: 1 } });
  if (roleChange) user.role = requestedRole;
  if (operationPermissions) user.operationPermissions = operationPermissions;
  if (name && !isAdminRole(user.role)) user.name = name;
  if (phone) user.phone = phone;
  user.status = 'ACTIVE';
  user.invitedAt = new Date();
  await user.save();
  return user;
}

module.exports = {
  ADMIN_ROLES,
  PORTAL_ROLES,
  isAdminRole,
  assertRoleAssignmentAllowed,
  assertCanManageAccount,
  sanitizeOperationPermissions,
  resolveLoginForEmployee
};
