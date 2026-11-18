// Company time is India (UTC+5:30), whatever the phone's own time zone is.
export const OFFSET_MINUTES = 330;
const pad = (n) => String(n).padStart(2, '0');

export function istParts(value = new Date()) {
  const d = new Date(new Date(value).getTime() + OFFSET_MINUTES * 60000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    weekday: d.getUTCDay()
  };
}

export function todayKey(now = new Date()) {
  const p = istParts(now);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function monthKey(now = new Date()) {
  return todayKey(now).slice(0, 7);
}

export function shiftMonth(month, delta) {
  const [y, m] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(month) {
  const [y, m] = String(month || '').split('-').map(Number);
  return m ? `${MONTHS_LONG[m - 1]} ${y}` : '';
}

/** "18 Nov 2026" for a date key or ISO value (shown in India time). */
export function formatDate(value, { year = true } = {}) {
  if (!value) return '—';
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : todayKey(value);
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`;
}

/** "Wed, 18 Nov" */
export function formatDay(value) {
  if (!value) return '—';
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : todayKey(value);
  const [y, m, d] = key.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${d} ${MONTHS[m - 1]}`;
}

/** "9:55 am" in India time. */
export function formatTime(value) {
  if (!value) return '—';
  const p = istParts(value);
  const h = p.hours % 12 || 12;
  return `${h}:${pad(p.minutes)} ${p.hours < 12 ? 'am' : 'pm'}`;
}

/** "10:00" (24 h) -> "10:00 am" */
export function formatClock(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm || '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

export function formatMinutes(total) {
  const n = Math.max(0, Math.round(Number(total) || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function ago(value) {
  if (!value) return '';
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return formatDate(value);
}

export function daysBetween(fromKey, toKey) {
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

export function money(value) {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
