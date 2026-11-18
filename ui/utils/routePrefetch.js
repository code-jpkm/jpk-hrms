const loaders = {
  '/': () => import('../views/Home.jsx'),
  '/dashboard': () => import('../views/Dashboard.jsx'),
  '/employees': () => import('../views/Employees.jsx'),
  '/recruitment': () => import('../views/Recruitment.jsx'),
  '/attendance': () => import('../views/Attendance.jsx'),
  '/attendance-rules': () => import('../views/AttendanceRules.jsx'),
  '/hierarchy': () => import('../views/Hierarchy.jsx'),
  '/probation': () => import('../views/Probation.jsx'),
  '/ai': () => import('../views/AIAssistant.jsx'),
  '/leave': () => import('../views/Leave.jsx'),
  '/regularization': () => import('../views/Regularization.jsx'),
  '/payroll': () => import('../views/Payroll.jsx'),
  '/holidays': () => import('../views/Holidays.jsx'),
  '/shifts': () => import('../views/Shifts.jsx'),
  '/access': () => import('../views/AdminAccess.jsx'),
  '/birthdays': () => import('../views/Birthdays.jsx'),
  '/biometric': () => import('../views/Biometric.jsx'),
  '/settings': () => import('../views/CompanySettings.jsx'),
  '/notices': () => import('../views/Notices.jsx'),
  '/account': () => import('../views/Account.jsx'),
};
const cache = new Set();

export function prefetchRoute(rawPath = '') {
  const path = String(rawPath || '').split('#')[0].split('?')[0] || '/';
  const loader = loaders[path];
  if (!loader || cache.has(path)) return;
  cache.add(path);
  const run = () => loader().catch(() => cache.delete(path));
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 900 });
  else setTimeout(run, 0);
}
