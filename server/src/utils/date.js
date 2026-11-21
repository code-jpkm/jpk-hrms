/**
 * A calendar-day key that is stable regardless of server timezone.
 *
 * THE BUG THIS REPLACES: code did `startOfDay(d).toISOString().slice(0, 10)`.
 * `startOfDay` works in SERVER-LOCAL time (setHours), but `toISOString`
 * converts to UTC. On an IST server those two disagree by 5h30m, so local
 * midnight on 15 Aug becomes 2026-08-14T18:30Z and the key came out as
 * "2026-08-14". A holiday saved for Independence Day rendered on the 14th, and
 * every regularization click sent the wrong date to the server.
 *
 * Formatting from LOCAL parts keeps the key and the displayed day in agreement.
 */
function dateKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Holidays and other whole-day values arrive as "YYYY-MM-DD" and Mongoose casts
 * them to UTC midnight. Read them back as a LOCAL calendar day so a date-only
 * value never drifts across a timezone boundary.
 */

/**
 * Semantic key for a whole-day value that may have been stored by either the
 * old IST-midnight serializer (18:30Z on the previous UTC day) or the new
 * UTC-midnight serializer. This keeps date-only HR data stable even when the
 * Node server itself runs in UTC.
 */
function semanticDateKey(value, timezoneOffsetMinutes = 330) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const atUtcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  const x = atUtcMidnight ? d : new Date(d.getTime() + Number(timezoneOffsetMinutes || 0) * 60000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

/** Canonical company-holiday key. Also repairs known Indian fixed holidays
 * that may already have been destructively saved one day early by an older
 * migration. */
function holidayDateKey(holiday, timezoneOffsetMinutes = 330) {
  const value = holiday?.date ?? holiday;
  const base = semanticDateKey(value, timezoneOffsetMinutes);
  if (!base) return '';
  const year = base.slice(0, 4);
  const name = String(holiday?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (name.includes('independence day')) return `${year}-08-15`;
  if (name.includes('republic day')) return `${year}-01-26`;
  if (name.includes('gandhi jayanti')) return `${year}-10-02`;
  return base;
}

/** Holidays carry location ALL / OFFICE / FACTORY; employees work at OFFICE, FACTORY or BOTH. */
function holidayAppliesTo(holiday, workLocation) {
  const where = String(holiday?.location || 'ALL').toUpperCase();
  if (where === 'ALL' || !where) return true;
  const loc = String(workLocation || '').toUpperCase();
  if (!loc || loc === 'BOTH') return true;
  return where === loc;
}

/** The company's current calendar day as UTC midnight (the convention attendance dates use). */
function companyToday(now = new Date(), offsetMinutes) {
  const offset = Number.isFinite(Number(offsetMinutes)) ? Number(offsetMinutes) : Number(process.env.HRMS_TIMEZONE_OFFSET_MINUTES || 330);
  const local = new Date(now.getTime() + offset * 60000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Hour of day (0-23) on the company clock, for greetings and messages. */
function companyHour(now = new Date(), offsetMinutes) {
  const offset = Number.isFinite(Number(offsetMinutes)) ? Number(offsetMinutes) : Number(process.env.HRMS_TIMEZONE_OFFSET_MINUTES || 330);
  return new Date(now.getTime() + offset * 60000).getUTCHours();
}

function calendarDay(value) {
  const key = semanticDateKey(value);
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function monthKey(date = new Date()) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${month}`;
}

function monthRange(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const from = new Date(year, monthNumber - 1, 1);
  const to = new Date(year, monthNumber, 0, 23, 59, 59, 999);
  return { from, to };
}

function eachDate(from, to) {
  const dates = [];
  const cursor = startOfDay(from);
  const end = startOfDay(to);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function companyOffsetMinutes() {
  const n = Number(process.env.HRMS_TIMEZONE_OFFSET_MINUTES ?? process.env.TIMEZONE_OFFSET_MINUTES ?? 330);
  return Number.isFinite(n) ? n : 330;
}

/** {year, month, day} of a calendar-day value: "YYYY-MM-DD" verbatim, otherwise the company-local day. */
function companyDayParts(value, offsetMinutes = companyOffsetMinutes()) {
  const ymd = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return { year: Number(ymd[1]), month: Number(ymd[2]), day: Number(ymd[3]) };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(d.getTime() + offsetMinutes * 60000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

function instantFromCompanyParts({ year, month, day }, hours, minutes, seconds = 0, ms = 0, offsetMinutes = companyOffsetMinutes()) {
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const result = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, ms) - offsetMinutes * 60000);
  return Number.isNaN(result.getTime()) ? null : result;
}

/**
 * Turns a user-entered date-time into an instant, using company time (IST by
 * default) whenever the value carries no zone. `datetime-local` inputs send
 * "2026-08-12T18:30"; `new Date()` would read that in the SERVER's zone, which
 * stores it 5h30m late on a UTC host.
 *
 *  - Date / epoch number / ISO with Z or ±hh:mm  -> taken as-is
 *  - "YYYY-MM-DDTHH:mm[:ss[.sss]]" (no zone)      -> company time
 *  - "HH:mm[:ss]" or "h[:mm] am/pm"               -> company time on `baseDate`
 *  - "YYYY-MM-DD"                                  -> company midnight
 * Returns undefined for empty input and null when the value cannot be read.
 */
function parseCompanyDateTime(value, offsetMinutes = companyOffsetMinutes(), { baseDate } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value) : null;
  const s = String(value).trim();
  if (!s) return undefined;
  const offset = Number(offsetMinutes);

  let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (m || ampm) {
    if (baseDate === undefined || baseDate === null || baseDate === '') return null;
    const day = companyDayParts(baseDate, offset);
    if (!day) return null;
    if (ampm) {
      const hour = Number(ampm[1]);
      if (hour < 1 || hour > 12) return null;
      return instantFromCompanyParts(day, (hour % 12) + (ampm[3].toLowerCase() === 'pm' ? 12 : 0), Number(ampm[2] || 0), 0, 0, offset);
    }
    return instantFromCompanyParts(day, Number(m[1]), Number(m[2]), Number(m[3] || 0), 0, offset);
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/);
  if (m) {
    return instantFromCompanyParts({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) },
      Number(m[4]), Number(m[5]), Number(m[6] || 0), Number(String(m[7] || '0').padEnd(3, '0')), offset);
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return instantFromCompanyParts({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, 0, 0, 0, 0, offset);

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Adds calendar months to a whole-day value without month-end overflow
 * (31 Aug + 6 months = 28/29 Feb, not 3 Mar). Returns UTC midnight of the
 * resulting calendar day, the same convention "YYYY-MM-DD" inputs use.
 */
function addMonthsClamped(value, months) {
  const key = semanticDateKey(value);
  if (!key) return new Date(NaN);
  const [year, month, day] = key.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + Number(months || 0), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)));
}

/**
 * A time of day on the company clock: "09:57:00 am" with seconds (punches),
 * "09:57 am" without. Same look as the website's formatTime.
 */
function formatCompanyTime(value, { seconds = false, offsetMinutes = companyOffsetMinutes() } = {}) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() + offsetMinutes * 60000);
  const h24 = local.getUTCHours();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h24 % 12 || 12)}:${pad(local.getUTCMinutes())}${seconds ? `:${pad(local.getUTCSeconds())}` : ''} ${h24 < 12 ? 'am' : 'pm'}`;
}

/** "12 Aug 2026" in India time, for letters and PDFs. */
function formatIndianDate(value, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...options });
}

module.exports = {
  dateKey, semanticDateKey, holidayDateKey,
  calendarDay, startOfDay, endOfDay, monthKey, monthRange, eachDate,
  parseCompanyDateTime, addMonthsClamped, formatIndianDate, formatCompanyTime, companyDayParts,
  holidayAppliesTo, companyToday, companyHour };
