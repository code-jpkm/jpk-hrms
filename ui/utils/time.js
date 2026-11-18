// Company-clock helpers. JPK runs on India time; the browser may not (a laptop
// set to UTC, a manager travelling). Every attendance value is shown and edited
// in IST so the screen always matches the biometric device and payroll.

export const COMPANY_TZ = 'Asia/Kolkata';
const OFFSET_MINUTES = 330;

const pad = (n) => String(n).padStart(2, '0');

export function istParts(value = new Date()) {
  const d = new Date(new Date(value).getTime() + OFFSET_MINUTES * 60000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds(),
    weekday: d.getUTCDay()
  };
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayKey(now = new Date()) {
  const p = istParts(now);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function currentMonthKey(now = new Date()) {
  return todayKey(now).slice(0, 7);
}

export function shiftMonth(month, delta) {
  const [y, m] = String(month).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function monthLabel(month, style = 'long') {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) return '';
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: style, year: 'numeric' });
}

/** A calendar day key ("2026-08-15") formatted without any timezone drift. */
export function formatDayKey(key, options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!key) return '—';
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { timeZone: 'UTC', ...options });
}

/** An instant shown on the company clock: "09:55 am". */
export function formatTime(value, { seconds = false } = {}) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true, timeZone: COMPANY_TZ });
}

/** An instant shown as an IST date: "12 Aug 2026". */
export function formatDate(value, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { timeZone: COMPANY_TZ, ...options });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return `${formatDate(value)} · ${formatTime(value)}`;
}

/**
 * Value for an <input type="datetime-local"> in IST ("2026-08-12T09:55").
 * The old screens used toISOString().slice(0, 16), which shows UTC — a 09:55
 * punch appeared as 04:25 and was saved back 5½ hours off.
 */
export function toIstInputValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = istParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hours)}:${pad(p.minutes)}`;
}

/** "YYYY-MM-DDTHH:mm" typed in IST -> ISO instant with an explicit +05:30 offset. */
export function istInputToIso(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) return s;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00+05:30` : s;
}

/** Minutes since IST midnight for an instant. */
export function istMinutes(value) {
  if (!value) return null;
  const p = istParts(value);
  return p.hours * 60 + p.minutes;
}

export function parseHHMM(text) {
  const m = String(text || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 485 -> "8h 05m"; 45 -> "45m". */
export function durationLabel(minutes, { short = false } = {}) {
  const m = Math.max(0, Math.round(Number(minutes || 0)));
  if (!m) return short ? '0m' : '0m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return short ? `${h}h${r ? ` ${r}m` : ''}` : `${h}h ${pad(r)}m`;
}

/** "09:30" -> "9:30 am" */
export function clockLabel(hhmm) {
  const mins = parseHHMM(hhmm);
  if (mins === null) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${pad(m)} ${suffix}`;
}

export function greetingFor(now = new Date()) {
  const h = istParts(now).hours;
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

export function initialsOf(name = '') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
}
