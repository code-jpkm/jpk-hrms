import { canAccessPath, hasAbility } from './permissions.js';

// Single source of truth for navigation. The app launcher (9-dot grid),
// the ⌘K command palette and the "My Favourites" cards all read from this.
// icon = a lucide-react icon name (resolved in components/Icon.jsx).

export const NAV_GROUPS = [
  {
    title: '',
    items: [
      { to: '/', label: 'Home', hint: 'Your day at a glance', icon: 'Home', tint: 'indigo' },
      { to: '/dashboard', label: 'Dashboard', hint: 'Company numbers and widgets', icon: 'LayoutDashboard', tint: 'indigo', hideForRoles: ['EMPLOYEE'], always: true },
    ],
  },
  {
    title: 'My work',
    items: [
      { to: '/attendance', label: 'Attendance', hint: 'Punches, calendar and team status', selfLabel: 'My attendance', selfHint: 'Your punches and monthly calendar', icon: 'CalendarCheck', tint: 'sky' },
      { to: '/leave', label: 'Leave', hint: 'Apply, approve and track leave', icon: 'Palmtree', tint: 'teal' },
      { to: '/regularization', label: 'Attendance correction', hint: 'Fix a missed or wrong punch', icon: 'FileClock', tint: 'sky' },
      { to: '/payroll', label: 'Payroll', hint: 'Salaries and payslips', selfLabel: 'My payslips', selfHint: 'Download your payslips', icon: 'Wallet', tint: 'amber' },
      { to: '/holidays', label: 'Holidays', hint: 'Company holiday calendar', icon: 'CalendarDays', tint: 'rose' },
      { to: '/notices', label: 'Notice board', hint: 'Announcements for everyone', icon: 'Megaphone', tint: 'amber' },
      { to: '/birthdays', label: 'Celebrations', hint: 'Birthdays and work anniversaries', icon: 'Cake', tint: 'rose' },
      { to: '/account', label: 'My profile', hint: 'Your details and documents', icon: 'CircleUser', tint: 'indigo', sidebar: false },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/employees', label: 'Employees', hint: 'Employee records and profiles', icon: 'Users', tint: 'indigo' },
      { to: '/hierarchy', label: 'Organisation chart', hint: 'Who reports to whom', icon: 'Network', tint: 'violet' },
      { to: '/recruitment', label: 'Recruitment', hint: 'Openings, applicants and joining', icon: 'UserPlus', tint: 'rose' },
      { to: '/probation', label: 'Probation', hint: 'Confirm new joiners', icon: 'ClipboardCheck', tint: 'amber' },
      { to: '/document-studio', label: 'Letters & documents', hint: 'Offer letters and HR documents', icon: 'FileText', tint: 'violet' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { to: '/shifts', label: 'Shifts', hint: 'Working hours for each team', icon: 'Clock', tint: 'violet' },
      { to: '/attendance-rules', label: 'Attendance rules', hint: 'Late marks, half days and overtime', icon: 'Sliders', tint: 'sky' },
      { to: '/biometric', label: 'Attendance machines', hint: 'Fingerprint machines send punches here', icon: 'Fingerprint', tint: 'violet' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/messages', label: 'Send a message', hint: 'Email or WhatsApp your people', icon: 'SendHorizontal', tint: 'violet' },
      { to: '/access', label: 'User access', hint: 'Who can see and do what', icon: 'ShieldCheck', tint: 'teal' },
      { to: '/settings', label: 'Company settings', hint: 'Company details and policies', icon: 'Settings2', tint: 'indigo' },
      { to: '/integrations', label: 'Email, WhatsApp & AI', hint: 'Connect email, WhatsApp and Gemini', icon: 'PlugZap', tint: 'teal' },
      { to: '/ai', label: 'AI assistant', hint: 'Ask Gemini an HR question', icon: 'Sparkles', tint: 'rose' },
    ],
  },
];

/** Label a person sees for a menu item ("My attendance" for an employee). */
export function navLabel(item, user) {
  if (!item) return '';
  const role = String(user?.role || '').toUpperCase();
  return role === 'EMPLOYEE' && item.selfLabel ? item.selfLabel : item.label;
}

/** One-line description shown under a module in the 9-dot menu. */
export function navHint(item, user) {
  if (!item) return '';
  const role = String(user?.role || '').toUpperCase();
  return role === 'EMPLOYEE' && item.selfHint ? item.selfHint : item.hint || '';
}

/** Every module this person can open, grouped, for the 9-dot menu. */
export function launcherGroups(user) {
  return NAV_GROUPS
    .map((g) => ({ ...g, title: g.title || 'Overview', items: g.items.filter((i) => canOpenNavItem(user, i)) }))
    .filter((g) => g.items.length);
}

/** Whether this person can open a menu page (Dashboard is open to every non-employee). */
export function canOpenNavItem(user, item) {
  const role = String(user?.role || '').toUpperCase();
  if (!item || (item.hideForRoles || []).includes(role)) return false;
  return item.always ? true : canAccessPath(user, item.to);
}

/** Sidebar sections for this user: only pages they can open. */
export function sidebarGroups(user) {
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.sidebar !== false && canOpenNavItem(user, i)) }))
    .filter((g) => g.items.length);
}

// Flatten for quick lookups.
export const NAV_ITEMS = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ ...i, group: g.title }))
);

export const PAGE_TITLES = Object.fromEntries(NAV_ITEMS.map((i) => [i.to, i.label]));

// Quick actions surface in the command palette and seed "My Favourites".
// Each points at a real destination (a route, optionally with a hash the
// target page can read to auto-open a panel).
export const QUICK_ACTIONS = [
  { id: 'prepare-letter', label: 'Prepare Letter', icon: 'FileText', to: '/recruitment#letter', tint: 'indigo' },
  { id: 'add-employee', label: 'Add Employee', icon: 'UserPlus', to: '/employees#new', tint: 'indigo' },
  { id: 'portal-access', label: 'Enable Portal Access', icon: 'KeyRound', to: '/access', tint: 'indigo' },
  { id: 'invite-employees', label: 'Invite Employees', icon: 'MailPlus', to: '/employees#invite', tint: 'indigo' },
  { id: 'delete-employee', label: 'Delete Employee', icon: 'UserMinus', to: '/employees', tint: 'indigo' },
  { id: 'update-payroll', label: 'Update Payroll Data', icon: 'Database', to: '/payroll', tint: 'peach' },
  { id: 'run-payroll', label: 'Run Payroll', icon: 'Wallet', to: '/payroll#run', tint: 'peach' },
  { id: 'approve-leave', label: 'Approve Leave', icon: 'CheckCircle2', to: '/leave', tint: 'teal' },
  { id: 'review-attendance', label: 'Review Attendance', icon: 'CalendarClock', to: '/attendance', tint: 'sky' },
  { id: 'add-holiday', label: 'Add Holiday', icon: 'CalendarDays', to: '/holidays#new', tint: 'rose' },
  { id: 'design-document', label: 'Design a Document', icon: 'FileText', to: '/document-studio', tint: 'indigo' },
  { id: 'ask-gemini', label: 'Ask Gemini AI', icon: 'Sparkles', to: '/ai', tint: 'rose' },
  { id: 'send-message', label: 'Send WhatsApp / Email', icon: 'SendHorizontal', to: '/messages', tint: 'violet' },
  { id: 'team-today', label: "Team Attendance Today", icon: 'Users', to: '/attendance#team', tint: 'sky' },
  { id: 'connect-integrations', label: 'Connect Email & WhatsApp', icon: 'PlugZap', to: '/integrations', tint: 'teal' },
  // Self-service shortcuts, used when someone has none of the admin actions above.
  { id: 'apply-leave', label: 'Apply Leave', icon: 'Palmtree', to: '/leave', tint: 'teal', selfService: true },
  { id: 'my-attendance', label: 'My Attendance', icon: 'CalendarCheck', to: '/attendance', tint: 'sky', selfService: true },
  { id: 'request-correction', label: 'Request Correction', icon: 'FileClock', to: '/regularization', tint: 'indigo', selfService: true },
  { id: 'celebrations', label: 'Wish a Colleague', icon: 'Cake', to: '/birthdays', tint: 'rose', selfService: true },
];

// What a non-admin needs before a management shortcut is worth showing.
// Managers keep their team shortcuts by role.
const ACTION_NEEDS = {
  'approve-leave': ['LEAVE', 'APPROVE', true],
  'review-attendance': ['ATTENDANCE', 'APPROVE', true],
  'team-today': ['ATTENDANCE', 'APPROVE', true],
  'run-payroll': ['PAYROLL', 'RUN'],
  'update-payroll': ['PAYROLL', 'MANAGE'],
  'add-employee': ['EMPLOYEES', 'CREATE'],
  'invite-employees': ['EMPLOYEES', 'CREATE'],
  'delete-employee': ['EMPLOYEES', 'DELETE'],
  'portal-access': ['ACCESS', 'MANAGE'],
  'add-holiday': ['HOLIDAYS', 'MANAGE'],
  'prepare-letter': ['DOCUMENTS', 'MANAGE'],
  'design-document': ['DOCUMENTS', 'MANAGE'],
};

/** Whether a shortcut leads somewhere this person can actually act. */
export function canUseQuickAction(user, a) {
  if (!a || !canAccessPath(user, a.to.split('#')[0])) return false;
  const role = String(user?.role || '').toUpperCase();
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(role)) return true;
  const need = ACTION_NEEDS[a.id];
  if (!need) return true;
  if (need[2] && role === 'MANAGER') return true;
  return hasAbility(user, need[0], need[1]);
}

/** Quick actions this user can really use; falls back to self-service ones. */
export function usableQuickActions(user, ids) {
  const admin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(String(user?.role || '').toUpperCase());
  const chosen = (ids || []).map((id) => QUICK_ACTION_BY_ID[id]).filter((a) => canUseQuickAction(user, a));
  if (chosen.length || admin) return chosen;
  return QUICK_ACTIONS.filter((a) => a.selfService && canUseQuickAction(user, a));
}

/** Starting "My Favourites" for someone who has not picked any yet. */
export function defaultFavouriteIds(user) {
  const role = String(user?.role || '').toUpperCase();
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(role)) return ['add-employee', 'review-attendance', 'approve-leave', 'update-payroll', 'send-message', 'ask-gemini'];
  if (role === 'MANAGER') return ['team-today', 'approve-leave', 'review-attendance', 'apply-leave', 'celebrations'];
  return ['apply-leave', 'my-attendance', 'request-correction', 'celebrations'];
}

export const QUICK_ACTION_BY_ID = Object.fromEntries(QUICK_ACTIONS.map((q) => [q.id, q]));

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Good Night';
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  if (h < 21) return 'Good Evening';
  return 'Good Night';
}
