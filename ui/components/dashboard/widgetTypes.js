// Data-driven widget model. A widget is a plain object:
//   { id, type, title, size: 'sm'|'md'|'lg', tint, config }
// Renderers live in WidgetGrid.jsx and read config. This file owns the
// catalog (for the "Add widget" menu), the default widgets for a fresh
// dashboard, and a local natural-language generator used as a graceful
// fallback when the Gemini backend endpoint is unavailable.

let counter = 0;
export function uid(prefix = 'w') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export const TINTS = ['indigo', 'violet', 'rose', 'amber', 'teal', 'sky', 'peach'];

// Blank templates the "Add widget" menu offers.
export const CATALOG = [
  { type: 'metric', name: 'Metric', icon: 'Gauge', desc: 'A single number with a label.' },
  { type: 'chart', name: 'Chart', icon: 'BarChart3', desc: 'Bar or line series.' },
  { type: 'list', name: 'List', icon: 'ListChecks', desc: 'A tidy list of rows.' },
  { type: 'progress', name: 'Progress', icon: 'TrendingUp', desc: 'Labelled progress bars.' },
  { type: 'quickActions', name: 'Quick actions', icon: 'CheckCircle2', desc: 'Buttons to common tasks.' },
  { type: 'note', name: 'Note', icon: 'StickyNote', desc: 'A free-text sticky note.' },
  { type: 'link', name: 'Link', icon: 'Link2', desc: 'A shortcut to any page or URL.' },
];

export function blankWidget(type) {
  const base = { id: uid(), type, size: 'md', tint: 'indigo' };
  switch (type) {
    case 'metric':
      return { ...base, size: 'sm', title: 'New metric', config: { value: 0, label: 'Label', helper: '', icon: 'Gauge' } };
    case 'chart':
      return {
        ...base, title: 'New chart',
        config: { kind: 'bar', unit: '', series: [{ label: 'A', value: 6 }, { label: 'B', value: 9 }, { label: 'C', value: 4 }, { label: 'D', value: 7 }] },
      };
    case 'list':
      return { ...base, title: 'New list', config: { items: [{ title: 'First item', sub: 'Details', badge: '' }] } };
    case 'progress':
      return { ...base, title: 'Progress', config: { rows: [{ label: 'Goal A', value: 60, max: 100 }, { label: 'Goal B', value: 35, max: 100 }] } };
    case 'quickActions':
      return { ...base, title: 'Quick actions', config: { actionIds: ['review-attendance', 'approve-leave', 'run-payroll'] } };
    case 'note':
      return { ...base, tint: 'amber', title: 'Note', config: { text: 'Type anything here…' } };
    case 'link':
      return { ...base, size: 'sm', title: 'Shortcut', config: { to: '/employees', label: 'Employee Directory', description: 'Open module' } };
    default:
      return { ...base, type: 'note', title: 'Note', config: { text: '' } };
  }
}

// Sensible starting dashboard. Metric/chart defaults BIND to live summary
// keys (resolved at render) so they always show real data even if seeded
// before the API responded.
export function defaultWidgets() {
  return [
    { id: uid(), type: 'metric', size: 'sm', tint: 'indigo', title: 'Headcount', config: { bind: 'employeeCount', label: 'Active employees', helper: 'in your scope', icon: 'Users' } },
    { id: uid(), type: 'metric', size: 'sm', tint: 'teal', title: 'Present today', config: { bind: 'attendanceToday', label: 'Present today', helper: 'marked today', icon: 'CalendarClock' } },
    { id: uid(), type: 'metric', size: 'sm', tint: 'amber', title: 'Pending leave', config: { bind: 'pendingLeaves', label: 'Leave approvals', helper: 'awaiting you', icon: 'Palmtree' } },
    { id: uid(), type: 'metric', size: 'sm', tint: 'violet', title: 'Regularizations', config: { bind: 'pendingRegularizations', label: 'To review', helper: 'pending', icon: 'FileClock' } },
    { id: uid(), type: 'chart', size: 'md', tint: 'indigo', title: 'Workforce split', config: { kind: 'bar', unit: '', bindSeries: 'workplace', series: [] } },
    { id: uid(), type: 'quickActions', size: 'md', tint: 'teal', title: 'Quick actions', config: { actionIds: ['review-attendance', 'approve-leave', 'run-payroll', 'add-employee'] } },
  ];
}

// Resolve a metric's live value: bound widgets read from summary; others use
// their stored value. Charts bind a whole series set the same way.
export function resolveValue(config, summary = {}) {
  if (config?.bind && summary && summary[config.bind] != null) return summary[config.bind];
  return config?.value ?? 0;
}
export function resolveSeries(config, summary = {}) {
  if (config?.bindSeries === 'workplace') {
    return [
      { label: 'Office', value: summary?.workplaceCounts?.office ?? 0 },
      { label: 'Factory', value: summary?.workplaceCounts?.factory ?? 0 },
    ];
  }
  return config?.series || [];
}

// ---------------------------------------------------------------------------
// Local natural-language generator. Best-effort keyword mapping so the studio
// works even before the Gemini backend endpoint is wired. The backend, once
// present, returns a far smarter spec and this is skipped.
export function localGenerate(prompt, summary = {}) {
  const p = String(prompt || '').toLowerCase();
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const tint = pick(TINTS);
  const title = titleFrom(prompt);

  const num = (re, fallback) => {
    const m = p.match(re);
    return m ? Number(m[1]) : fallback;
  };

  if (/(note|remind|memo|sticky)/.test(p)) {
    return { id: uid(), type: 'note', size: 'md', tint: 'amber', title, config: { text: cleanPrompt(prompt) } };
  }
  if (/(line chart|trend|over time|monthly|weekly)/.test(p)) {
    return { id: uid(), type: 'chart', size: 'md', tint, title, config: { kind: 'line', unit: '', series: months(6) } };
  }
  if (/(chart|graph|bar|distribution|by department|by team|split|breakdown)/.test(p)) {
    let series;
    if (/department|team|split|workforce/.test(p)) {
      series = [
        { label: 'Office', value: summary?.workplaceCounts?.office ?? rnd(20, 60) },
        { label: 'Factory', value: summary?.workplaceCounts?.factory ?? rnd(20, 60) },
      ];
    } else series = [{ label: 'A', value: rnd(4, 12) }, { label: 'B', value: rnd(4, 12) }, { label: 'C', value: rnd(4, 12) }, { label: 'D', value: rnd(4, 12) }];
    return { id: uid(), type: 'chart', size: 'md', tint, title, config: { kind: 'bar', unit: '', series } };
  }
  if (/(progress|goal|target|completion|percentage|%)/.test(p)) {
    return {
      id: uid(), type: 'progress', size: 'md', tint, title,
      config: { rows: [{ label: 'Onboarding', value: rnd(40, 90), max: 100 }, { label: 'Payroll review', value: rnd(20, 80), max: 100 }, { label: 'Doc collection', value: rnd(30, 95), max: 100 }] },
    };
  }
  if (/(list|pending|approvals|tasks|requests|upcoming|holiday|birthday)/.test(p)) {
    let items;
    if (/holiday/.test(p)) items = [{ title: 'Independence Day', sub: '15 Aug · Friday', badge: 'Public' }, { title: 'Onam', sub: '05 Sep', badge: 'Regional' }];
    else if (/birthday/.test(p)) items = [{ title: 'Celebrate today', sub: 'Check the Birthdays module', badge: '🎂' }];
    else items = [
      { title: 'Leave approvals', sub: `${summary.pendingLeaves ?? 0} awaiting you`, badge: 'Leave' },
      { title: 'Regularizations', sub: `${summary.pendingRegularizations ?? 0} to review`, badge: 'Attendance' },
      { title: 'Probation reviews', sub: 'Due this month', badge: 'HR' },
    ];
    return { id: uid(), type: 'list', size: 'md', tint, title, config: { items } };
  }
  if (/(action|button|shortcut|quick)/.test(p)) {
    return { id: uid(), type: 'quickActions', size: 'md', tint, title, config: { actionIds: ['review-attendance', 'approve-leave', 'run-payroll', 'add-employee'] } };
  }
  if (/(link|open|go to)/.test(p)) {
    const to = /payroll/.test(p) ? '/payroll' : /leave/.test(p) ? '/leave' : /attendance/.test(p) ? '/attendance' : '/employees';
    return { id: uid(), type: 'link', size: 'sm', tint, title, config: { to, label: title, description: 'Open module' } };
  }
  // default → metric, use a matching summary value if the prompt names one.
  let value = num(/(\d+)/, null);
  let label = 'Count';
  if (/employee|headcount|staff|people/.test(p)) { value = value ?? summary.employeeCount ?? 0; label = 'Active employees'; }
  else if (/present|attendance/.test(p)) { value = value ?? summary.attendanceToday ?? 0; label = 'Present today'; }
  else if (/leave/.test(p)) { value = value ?? summary.pendingLeaves ?? 0; label = 'Pending leave'; }
  else value = value ?? 0;
  return { id: uid(), type: 'metric', size: 'sm', tint, title, config: { value, label, helper: 'generated by Gemini', icon: 'Gauge' } };
}

function months(n) {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date().getMonth();
  return Array.from({ length: n }, (_, i) => ({ label: names[(now - (n - 1) + i + 12) % 12], value: rnd(4, 20) }));
}
function rnd(a, b) { return Math.round(a + Math.random() * (b - a)); }
function cleanPrompt(s) { return String(s || '').replace(/^(add|create|make|show|a|an|note that says|note:)\s+/i, '').trim(); }
function titleFrom(s) {
  const t = cleanPrompt(s);
  const short = t.split(/[.,\n]/)[0].slice(0, 42);
  return short.charAt(0).toUpperCase() + short.slice(1) || 'New widget';
}
