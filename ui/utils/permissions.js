export function hasAbility(user, moduleName, action) {
  if (!user) return false;
  const role = String(user.role || '').toUpperCase();
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(role)) return true;
  const perms = user.operationPermissions || {};
  if (perms.allowAll) return true;
  const found = (perms.modules || []).find((m) => String(m.module).toUpperCase() === String(moduleName).toUpperCase());
  const actions = found?.actions?.map((a) => String(a).toUpperCase()) || [];
  return actions.includes('ALL') || actions.includes('MANAGE') || actions.includes(String(action).toUpperCase());
}

export function canAccessPath(user, path) {
  if (!user) return false;
  // Celebrations are company-wide so everyone can wish colleagues.
  if (path === '/' || path === '/account' || path === '/notices' || path === '/birthdays') return true;
  const role = String(user.role || '').toUpperCase();
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(role)) return true;
  const map = {
    '/employees': ['EMPLOYEES', 'READ'],
    '/recruitment': ['RECRUITMENT', 'READ'],
    '/attendance': ['ATTENDANCE', 'READ'],
    '/attendance-rules': ['ATTENDANCE_RULES', 'READ'],
    '/permissions': ['PERMISSIONS', 'READ'],
    '/hierarchy': ['HIERARCHY', 'READ'],
    '/probation': ['PROBATION', 'READ'],
    '/ai': ['AI', 'READ'],
    '/leave': ['LEAVE', 'READ'],
    '/regularization': ['REGULARIZATION', 'READ'],
    '/payroll': ['PAYROLL', 'READ'],
    '/holidays': ['HOLIDAYS', 'READ'],
    '/shifts': ['SHIFTS', 'READ'],
    '/access': ['ACCESS', 'READ'],
    '/birthdays': ['EMPLOYEES', 'READ'],
    '/biometric': ['BIOMETRIC', 'READ'],
    '/settings': ['COMPANY_SETTINGS', 'READ'],
    '/document-studio': ['DOCUMENTS', 'MANAGE'],
    '/integrations': ['COMPANY_SETTINGS', 'MANAGE']
  };
  if (path === '/messages') return hasAbility(user, 'NOTICES', 'MANAGE') || hasAbility(user, 'MESSAGES', 'SEND');
  // Managers receive probation-review reminders, so they must be able to open /probation.
  // Shifts, organisation chart and recruitment need an explicit ability: the API refuses managers without it.
  if (role === 'MANAGER' && ['/attendance', '/leave', '/permissions', '/regularization', '/holidays', '/employees', '/probation'].includes(path)) return true;
  if (role === 'EMPLOYEE' && ['/attendance', '/leave', '/permissions', '/regularization', '/holidays', '/payroll', '/birthdays'].includes(path)) return true;
  const ability = map[path];
  return ability ? hasAbility(user, ability[0], ability[1]) : false;
}

// Who may edit the customizable dashboard (drag/drop, add/remove widgets,
// generate widgets with Gemini). Admins always can; others need an explicit
// DASHBOARD/MANAGE ability. This mirrors what the backend should enforce too.
export function canCustomizeDashboard(user) {
  if (!user) return false;
  const role = String(user.role || '').toUpperCase();
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(role)) return true;
  return hasAbility(user, 'DASHBOARD', 'MANAGE');
}

export function canApplyOnBehalf(user) {
  if (!user) return false;
  const role = String(user.role || '').toUpperCase();
  if (['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'].includes(role)) return true;
  return hasAbility(user, 'LEAVE', 'APPLY_ON_BEHALF') || hasAbility(user, 'REGULARIZATION', 'APPLY_ON_BEHALF') || hasAbility(user, 'PERMISSIONS', 'MANAGE');
}

/**
 * Work From Home visibility.
 *
 * An employee who cannot apply for WFH should not see the words anywhere —
 * not in the leave hero, not in the calendar legend, not in a dashboard label.
 * Seeing an option you can never use reads as a bug or as favouritism.
 *
 * It stays visible for anyone who administers it for others: Super Admin, HR
 * Admin, and approvers with LEAVE approve/manage rights, since they must be able
 * to read and decide other people's WFH requests.
 */
export function canSeeWfh(user, employee) {
  if (employee?.canApplyWfh === true) return true;
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role)) return true;
  if (hasAbility(user, 'LEAVE', 'APPROVE') || hasAbility(user, 'LEAVE', 'MANAGE')) return true;
  return false;
}

/** Label helper so a gated screen never has to hard-code the string. */
export function timeOffLabel(user, employee, { withWfh, withoutWfh } = {}) {
  return canSeeWfh(user, employee)
    ? (withWfh ?? 'Leave & WFH')
    : (withoutWfh ?? 'Leave & Time Off');
}
