// Finding a shift among many (the company has 70+): by name, code, time or weekly off.
// "F12", "9:30", "930", "9am", "8-5" (8 to 5, am or pm), "sat off", "night".

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** F1, F2 … F10 (numbers in names sort as numbers). */
export const naturalCompare = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "6:00 am" from "06:00". */
export function ampm(hhmm) {
  const t = toMinutes(hhmm);
  if (t === null) return String(hhmm || '');
  const h = Math.floor(t / 60) % 24;
  const m = t % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Minutes from start to end; overnight shifts wrap, a 24-hour duty (start = end) is 1440. */
export function shiftLength(shift) {
  const s = toMinutes(shift?.startTime);
  const e = toMinutes(shift?.endTime);
  if (s === null || e === null) return null;
  const d = e - s;
  return d > 0 ? d : d + 1440;
}

export const isOvernight = (shift) => {
  const s = toMinutes(shift?.startTime);
  const e = toMinutes(shift?.endTime);
  return s !== null && e !== null && e <= s;
};

export function weeklyOffLabel(shift) {
  const days = Array.isArray(shift?.weeklyOffDays) ? shift.weeklyOffDays : [0];
  if (!days.length) return 'No weekly off';
  return `${days.slice().sort((a, b) => a - b).map((d) => DAYS[d]).filter(Boolean).join(', ')} off`;
}

const lengthLabel = (minutes) => {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

/** "6:00 am – 6:00 pm · 12h · Sun off" */
export function shiftDetails(shift) {
  return [
    `${ampm(shift?.startTime)} – ${ampm(shift?.endTime)}${isOvernight(shift) && shiftLength(shift) !== 1440 ? ' (next day)' : ''}`,
    lengthLabel(shiftLength(shift)),
    weeklyOffLabel(shift),
  ].filter(Boolean).join(' · ');
}

/** A word that is a clock time: 9, 09, 9:30, 0930, 930, 9.30, 9am, 9:30 pm, 21, 2130. */
function readTime(word) {
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|a|p)?$/.exec(word);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] !== undefined ? Number(m[2]) : null;
  if (h > 24 || (min !== null && min > 59)) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3].startsWith('p');
    return { hours: [(h % 12) + (pm ? 12 : 0)], min };
  }
  // "8" or "08" alone could be 8 am or 8 pm.
  if (min === null && h >= 1 && h <= 11) return { hours: [h, h + 12], min };
  return { hours: [h % 24], min };
}

function timeMatches(t, hhmm) {
  const x = toMinutes(hhmm);
  if (x === null) return false;
  return t.hours.includes(Math.floor(x / 60) % 24) && (t.min === null || t.min === x % 60);
}

/** Splits "8-5", "8 to 5", "9:30 am", "F1 · Sat off" into words. */
export function queryWords(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/(\d)\s+(am|pm)\b/g, '$1$2')
    .replace(/[–—·,|/]+/g, ' ')
    .replace(/(\d)-(\d)/g, '$1 $2')
    .replace(/\s-\s|\bto\b/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}

function haystack(shift) {
  return [
    shift.name, shift.code, shift.startTime, shift.endTime, ampm(shift.startTime), ampm(shift.endTime),
    weeklyOffLabel(shift), isOvernight(shift) ? 'night overnight' : '', lengthLabel(shiftLength(shift)),
  ].join(' ').toLowerCase();
}

/**
 * Shifts that match every word of the query, best first:
 * exact code / name, then code or name starting with it, then the rest; F1 before F10.
 * With no query: all of them, natural order.
 */
export function searchShifts(shifts, query) {
  const list = (shifts || []).filter(Boolean);
  const words = queryWords(query);
  const ordered = list.slice().sort((a, b) => naturalCompare(a.name, b.name));
  if (!words.length) return ordered;
  const q = String(query || '').trim().toLowerCase();
  const scored = [];
  for (const shift of ordered) {
    const hay = haystack(shift);
    const code = String(shift.code || '').toLowerCase();
    const name = String(shift.name || '').toLowerCase();
    const firstWord = name.split(/[\s·]+/)[0];
    const ok = words.every((w) => {
      const t = readTime(w);
      // A number is a time ("6" = 6 am or 6 pm), not any "6" in a name (F16) —
      // unless a code or name starts with it (5PM5, 7353).
      if (t) return timeMatches(t, shift.startTime) || timeMatches(t, shift.endTime) || code.startsWith(w) || firstWord.startsWith(w);
      return hay.includes(w);
    });
    if (!ok) continue;
    let score = 4;
    if (code === q || name === q || firstWord === q) score = 0;
    else if (code && code.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (hay.includes(q)) score = 3;
    scored.push({ shift, score });
  }
  return scored.sort((a, b) => a.score - b.score || naturalCompare(a.shift.name, b.shift.name)).map((x) => x.shift);
}

const RECENT_KEY = 'hrms_recent_shifts';

export function recentShiftIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberShift(id) {
  if (!id) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentShiftIds().filter((x) => x !== id)].slice(0, 5)));
  } catch {
    /* private mode: no list of recent shifts */
  }
}
