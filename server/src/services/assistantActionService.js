/**
 * The corner HR chat doing HR tasks, not only answering questions.
 *
 *   "change Punit Agarwal shift Monday to Friday 10:30 am to 6:30 pm and Saturday 10:30 am to 3:30 pm"
 *   "apply 1 day EL for Sukesh on 30 Nov"            (HR: approved at once)
 *   "approve Sukesh's leave" / "reject …"
 *   "mark Aindrila present on 12 Nov" / "remove LOP for … on …"
 *   "correct my out time on 12 Nov to 6:15 pm"
 *
 * Every task is checked against the signed-in person's own permissions and
 * Office / Factory scope first. Without permission the chat says so and asks
 * them to contact their administrator / HR. With permission it shows exactly
 * what will change and waits for "Confirm"; the confirmation carries a signed,
 * single-use token, and the permission is checked again before anything is
 * saved. The work itself goes through the same code as the screens (shift
 * pattern service, leave request, calendar day actions), so the audit trail,
 * notifications, attendance and payroll draft all follow as usual.
 *
 * Requests are read by Gemini when it is set up (Company Settings → AI) and by
 * plain rules otherwise, so the chat keeps working without AI.
 */
const crypto = require('crypto');
const ApiError = require('../utils/apiError');
const Employee = require('../models/Employee');
const Shift = require('../models/Shift');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const env = require('../config/env');
const { hasAbility } = require('../middleware/auth');
const { getScopedEmployeeIds } = require('./scopeService');
const { canApproveEmployee, getReportingManager } = require('./approvalService');
const { dateKey, companyToday } = require('../utils/date');
const { latestAssignmentOn } = require('../utils/shift');
const shiftPattern = require('./shiftPatternService');
const { weekdaysLabel, normalizeWeekdays } = require('./shiftAssignmentService');

const ASK_ADMIN = 'Please contact your administrator / HR.';
const TOKEN_LIFE_MS = 15 * 60 * 1000;
const usedTokens = new Map();

const DAY_WORDS = { sun: 0, sunday: 0, sundays: 0, mon: 1, monday: 1, mondays: 1, tue: 2, tues: 2, tuesday: 2, tuesdays: 2, wed: 3, weds: 3, wednesday: 3, wednesdays: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4, fri: 5, friday: 5, fridays: 5, sat: 6, saturday: 6, saturdays: 6 };
const MONTH_WORDS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const DAY_RE = '(?:sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|days|nesday|nesdays|rsday|rsdays|urday|urdays|sday|sdays)?';
const TIME_RE = '\\d{1,2}(?:[:.]\\d{2})?\\s*(?:am|pm|a\\.m\\.|p\\.m\\.)?';
const MONTH_RE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'into', 'onto', 'shift', 'shifts', 'timing', 'timings', 'time', 'change', 'changed', 'set', 'assign', 'update', 'make', 'move', 'please', 'pls', 'kindly', 'can', 'you', 'will', 'should', 'would', 'his', 'her', 'their', 'him', 'them',
  'leave', 'leaves', 'apply', 'applied', 'add', 'put', 'record', 'grant', 'give', 'approve', 'approved', 'accept', 'reject', 'rejected', 'decline', 'mark', 'marked', 'remove', 'waive', 'cancel', 'present', 'absent', 'half', 'day', 'days', 'full', 'lop', 'loss', 'pay', 'today', 'tomorrow', 'yesterday', 'onwards', 'onward', 'starting', 'till', 'until', 'upto', 'between', 'every', 'each', 'week', 'weekdays', 'weekday', 'weekend', 'weekends', 'off', 'holiday', 'work', 'home', 'wfh', 'casual', 'sick', 'earned', 'comp', 'reason', 'because', 'regularize', 'regularise', 'correct', 'fix', 'punch', 'check', 'out', 'and', 'also', 'next', 'this', 'that', 'only', 'all', 'daily', 'morning', 'afternoon', 'first', 'second', 'request', 'requests', 'pending', 'its', 'it',
  ...Object.keys(DAY_WORDS), ...Object.keys(MONTH_WORDS)
]);

/* ------------------------------------------------------------- words in */

/** Is this message asking the chat to DO something (rather than asking a question)? */
function looksLikeAction(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const verb = /\b(change|changing|set|assign|update|make|move|shift\s+(?:him|her|them)|apply|add|put|record|give|grant|approve|accept|reject|decline|mark|remove|waive|cancel|regulari[sz]e|correct|fix)\b/.test(t);
  const object = /\b(shift|shifts|timing|timings|leave|leaves|wfh|work from home|present|absent|half[\s-]?day|lop|loss of pay|regulari[sz]|check[\s-]?in|check[\s-]?out|in[\s-]?time|out[\s-]?time|punch|el|cl|sl|comp[\s-]?off)\b/.test(t)
    // "should work 10:30 to 6:30 on weekdays": working hours with a time range
    || (/\b(work|works|working|duty|hours|office)\b/.test(t) && new RegExp(`${TIME_RE}\\s*(?:to|-|till|until)\\s*${TIME_RE}`).test(t));
  if (!verb || !object) return false;
  // "is X present?", "what is my shift" are questions even with a verb-like word in them.
  if (/^\s*(is|was|are|were|who|what|when|which|how|why|does|did|do|show|tell|list)\b/.test(t) && !/\b(please|pls|kindly)\b/.test(t)) return false;
  return true;
}

function ymd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
function addDays(key, n) { return new Date(Date.parse(`${key}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10); }
function weekdayOfKey(key) { return new Date(`${key}T00:00:00.000Z`).getUTCDay(); }

/** "27 nov", "27th november 2026", "nov 27", "27/11", "27-11-2026", "2026-11-27", "today", "on monday" → YYYY-MM-DD. */
function dateFrom(fragment, todayKey) {
  const s = String(fragment || '').toLowerCase().trim();
  const year = Number(todayKey.slice(0, 4));
  if (/^day after tomorrow$/.test(s)) return addDays(todayKey, 2);
  if (/^(today|now)$/.test(s)) return todayKey;
  if (/^tomorrow$/.test(s)) return addDays(todayKey, 1);
  if (/^yesterday$/.test(s)) return addDays(todayKey, -1);
  let m = s.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) return ymd(m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year, Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]+)\.?(?:,?\s+(20\d{2}))?$/);
  if (m && MONTH_WORDS[m[2]]) return ymd(m[3] ? Number(m[3]) : year, MONTH_WORDS[m[2]], Number(m[1]));
  m = s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?$/);
  if (m && MONTH_WORDS[m[1]]) return ymd(m[3] ? Number(m[3]) : year, MONTH_WORDS[m[1]], Number(m[2]));
  m = s.match(/^(?:next\s+|this\s+|coming\s+)?([a-z]+)$/);
  if (m && DAY_WORDS[m[1]] !== undefined) {
    const want = DAY_WORDS[m[1]];
    let key = todayKey;
    // "next monday" is the one after the coming one only when today is Monday.
    for (let i = 0; i < 7 && weekdayOfKey(key) !== want; i += 1) key = addDays(key, 1);
    if (/^next\s/.test(s) && key === todayKey) key = addDays(key, 7);
    return key;
  }
  return null;
}

const DATE_RE = `(?:day after tomorrow|today|tomorrow|yesterday|20\\d{2}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\.?(?:,?\\s+20\\d{2})?|${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?|(?:next\\s+|this\\s+|coming\\s+)?${DAY_RE})`;

/**
 * Dates in a request: a range ("from 1 Dec to 5 Dec", "1 dec – 5 dec"), a start
 * ("from 1 Dec", "starting Monday", "w.e.f. 1 Dec") or single days ("on 30 Nov").
 * `allowDayNames` is off for shifts, where "Monday to Friday" are working days.
 */
function readDates(text, todayKey, { allowDayNames = true } = {}) {
  const t = String(text || '').toLowerCase();
  const d = (frag) => {
    if (!allowDayNames && new RegExp(`^(?:next\\s+|this\\s+|coming\\s+)?${DAY_RE}$`).test(frag.trim())) return null;
    return dateFrom(frag, todayKey);
  };
  // Day names are dates for a shift only after "from", "starting", "on", "next"…
  const lead = allowDayNames ? '' : '(?:from|starting(?:\\s+from)?|wef|w\\.e\\.f\\.?|effective(?:\\s+from)?|on|next|this|coming)\\s+';
  let m = t.match(new RegExp(`(?:from|between|starting|wef|w\\.e\\.f\\.?)?\\s*(${DATE_RE})\\s*(?:to|till|until|upto|up to|through|-|–|and)\\s*(${DATE_RE})`));
  if (m) {
    const a = d(m[1]);
    const b = d(m[2]);
    if (a && b) return { fromDate: a, toDate: b < a && !/\d{4}/.test(m[2]) ? addDays(b, 365) : b, kind: 'RANGE' };
  }
  m = t.match(new RegExp(`(?:from|starting(?:\\s+from)?|wef|w\\.e\\.f\\.?|effective(?:\\s+from)?|with effect from)\\s+(${DATE_RE})`));
  if (m) {
    const a = dateFrom(m[1], todayKey);
    if (a) return { fromDate: a, toDate: null, kind: 'FROM' };
  }
  const singles = [];
  const re = new RegExp(`${lead}(${DATE_RE})`, 'g');
  for (const hit of t.matchAll(re)) {
    const a = allowDayNames ? d(hit[1]) : dateFrom(hit[1], todayKey);
    if (a && !singles.includes(a)) singles.push(a);
  }
  if (singles.length) return { fromDate: singles[0], toDate: singles.length > 1 ? singles[singles.length - 1] : singles[0], kind: singles.length > 1 ? 'RANGE' : 'DAY', days: singles };
  return { fromDate: null, toDate: null, kind: 'NONE' };
}

function dayListFrom(spec) {
  const s = spec.toLowerCase().replace(/\./g, '').trim();
  if (/^(all days|every ?day|daily|all week|7 days)$/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^week ?days?$/.test(s)) return [1, 2, 3, 4, 5];
  if (/^week ?ends?$/.test(s)) return [6, 0];
  const range = s.match(new RegExp(`^(${DAY_RE})\\s*(?:to|-|–|till|through|thru)\\s*(${DAY_RE})$`));
  if (range) {
    const a = DAY_WORDS[range[1]];
    const b = DAY_WORDS[range[2]];
    if (a === undefined || b === undefined) return null;
    const out = [];
    for (let x = a; ; x = (x + 1) % 7) { out.push(x); if (x === b || out.length > 7) break; }
    return out;
  }
  const names = s.split(/\s*(?:,|and|&|\/)\s*/).filter(Boolean);
  const out = names.map((n) => DAY_WORDS[n.trim()]).filter((x) => x !== undefined);
  return out.length === names.length && out.length ? out : null;
}

/** "10:30 to 6:30" → 10:30–18:30; "6 pm to 6" → 18:00–06:00; "9 to 6" → 09:00–18:00. */
function timeRangeFrom(startRaw, endRaw) {
  const hasAp = (x) => /(am|pm|a\.m\.|p\.m\.)/i.test(x);
  let start = shiftPattern.normalizeTime(startRaw);
  let end = shiftPattern.normalizeTime(endRaw);
  if (!start || !end) return null;
  const mins = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
  if (!hasAp(endRaw) && hasAp(startRaw) && /pm/i.test(startRaw) && mins(end) < mins(start) && mins(end) < 12 * 60 && mins(end) + 12 * 60 > mins(start)) {
    end = `${String(Number(end.slice(0, 2)) + 12).padStart(2, '0')}${end.slice(2)}`;
  }
  if (!hasAp(startRaw) && !hasAp(endRaw) && mins(end) <= mins(start) && mins(end) < 12 * 60) {
    end = `${String(Number(end.slice(0, 2)) + 12).padStart(2, '0')}${end.slice(2)}`;
  }
  if (!hasAp(startRaw) && hasAp(endRaw) && /pm/i.test(endRaw) && mins(start) < 12 * 60 && mins(start) + 12 * 60 < mins(end) && Number(start.slice(0, 2)) < 7) {
    // "2 to 10 pm" is 2 pm to 10 pm.
    start = `${String(Number(start.slice(0, 2)) + 12).padStart(2, '0')}${start.slice(2)}`;
  }
  return { startTime: start, endTime: end };
}

/**
 * The weekly pattern in a shift request: each timing with its days.
 * "Monday to Friday 10:30 am to 6:30 pm and for Saturday 10:30 am to 3:30 pm"
 * "10 to 6 on weekdays, Saturday 10 to 2, Sunday off"
 */
function readShiftPattern(text) {
  const t = String(text || '').toLowerCase().replace(/[–—]/g, '-');
  const daySpec = `(?:all days|every ?day|daily|week ?days?|week ?ends?|${DAY_RE}(?:\\s*(?:to|-|till|through|thru)\\s*${DAY_RE})?(?:\\s*(?:,|and|&|\\/)\\s*${DAY_RE})*)`;
  const days = [...t.matchAll(new RegExp(`\\b(${daySpec})\\b`, 'g'))].map((m) => ({ start: m.index, end: m.index + m[0].length, list: dayListFrom(m[1]), text: m[1] })).filter((x) => x.list);
  // Plain numbers ("10 to 6") are times too, unless they are dates ("1 to 5 Dec").
  const looksLikeDate = (end) => new RegExp(`^\\s*(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}`).test(t.slice(end, end + 16));
  const times = [...t.matchAll(new RegExp(`(${TIME_RE})\\s*(?:to|-|till|until)\\s*(${TIME_RE})`, 'g'))]
    .filter((m) => /\d/.test(m[1]) && /\d/.test(m[2]) && (/[:.]|am|pm/.test(`${m[1]} ${m[2]}`) || !looksLikeDate(m.index + m[0].length)))
    .map((m) => ({ start: m.index, end: m.index + m[0].length, range: timeRangeFrom(m[1], m[2]) }))
    .filter((x) => x.range);
  const filler = /^[\s,:;()-]*(?:(?:for|on|every|each|the|shift|shifts|timing|timings|time|will|be|is|are|as|it|its|should|at|from|of|with|and|then|but|also|make|it's)\b[\s,:;()-]*)*$/;
  const used = new Set();
  const segments = [];
  for (const tr of times) {
    let pick = null;
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const dsp = days[i];
      if (used.has(i) || dsp.end > tr.start) continue;
      if (filler.test(t.slice(dsp.end, tr.start))) { pick = i; }
      break;
    }
    if (pick === null) {
      for (let i = 0; i < days.length; i += 1) {
        const dsp = days[i];
        if (used.has(i) || dsp.start < tr.end) continue;
        if (filler.test(t.slice(tr.end, dsp.start))) pick = i;
        break;
      }
    }
    if (pick !== null) used.add(pick);
    segments.push({ weekdays: pick !== null ? days[pick].list : null, ...tr.range });
  }
  // "Sunday off", "off on Sunday", "Sunday holiday"
  const offDays = [];
  for (const [i, dsp] of days.entries()) {
    if (used.has(i)) continue;
    const after = t.slice(dsp.end, dsp.end + 22);
    const before = t.slice(Math.max(0, dsp.start - 16), dsp.start);
    if (/^\s*(?:is\s+|will be\s+|as\s+)?(?:a\s+)?(?:weekly\s+)?(?:off|holiday)\b/.test(after) || /\boff\s+(?:on\s+)?$/.test(before)) offDays.push(...dsp.list);
  }
  return { segments, offDays: Array.from(new Set(offDays)), dayWordsUsed: days.filter((_, i) => used.has(i)).map((x) => x.text) };
}

function readLeaveType(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  if (/\b(wfh|work from home|work-from-home)\b/.test(t)) return 'WFH';
  if (/\b(lop|loss of pay|unpaid|without pay)\b/.test(t)) return 'LOP';
  if (/\bcomp[\s-]?off\b|\bcompensatory\b/.test(t)) return 'COMP_OFF';
  if (/\b(sl|sick)\b/.test(t)) return 'SL';
  if (/\b(cl|casual)\b/.test(t)) return 'CL';
  if (/\b(el|earned|privilege|pl)\b/.test(t)) return 'EL';
  return null;
}

function readDayPart(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(first half|1st half|morning half|morning)\b/.test(t)) return 'FIRST_HALF';
  if (/\b(second half|2nd half|afternoon half|afternoon|evening)\b/.test(t)) return 'SECOND_HALF';
  if (/\bhalf[\s-]?day\b/.test(t)) return 'FIRST_HALF';
  return 'FULL';
}

function readReason(text) {
  const m = String(text || '').match(/\b(?:reason|because|as|due to)\b[:\s-]+(.{3,160})$/i);
  return m ? m[1].trim().replace(/[.\s]+$/, '') : '';
}

/** in / out times in "in 10:05 out 6:15 pm", "check in at 10:05", "out time to 6:15 pm". */
function readInOut(text) {
  const t = String(text || '').toLowerCase();
  // The first clock time after the word: "10:05", "6:15 pm", "6 pm" (plain numbers are dates here).
  const clock = /(\d{1,2}[:.]\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))/;
  const after = (re) => {
    const k = t.match(re);
    if (!k) return null;
    const rest = t.slice(k.index + k[0].length);
    const stop = rest.search(/\b(?:check[\s-]?in|in[\s-]?time|punch[\s-]?in|check[\s-]?out|out[\s-]?time|punch[\s-]?out)\b/);
    const m = (stop > 0 ? rest.slice(0, stop) : rest).match(clock);
    return m ? { raw: m[1], time: shiftPattern.normalizeTime(m[1]) } : null;
  };
  const inHit = after(/\b(?:check[\s-]?in|in[\s-]?time|punch[\s-]?in|came in|came at|\bin\b)/);
  const outHit = after(/\b(?:check[\s-]?out|out[\s-]?time|punch[\s-]?out|left at|leaving|\bout\b)/);
  let checkIn = inHit?.time || null;
  let checkOut = outHit?.time || null;
  // An out time like "6:15" with no am / pm is in the evening.
  if (checkOut && !/(am|pm)/.test(outHit.raw) && Number(checkOut.slice(0, 2)) < 9) checkOut = `${String(Number(checkOut.slice(0, 2)) + 12).padStart(2, '0')}${checkOut.slice(2)}`;
  if (checkIn === '00:00') checkIn = null;
  return { checkIn, checkOut };
}

/** What the request asks for, read with plain rules. */
function parseRules(text, todayKey) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const self = /\b(my|me|mine|myself|i)\b/.test(t);
  if (/\b(shift|shifts|timing|timings|working hours|office hours|duty hours|work hours|duty time)\b/.test(t) && /\b(change|set|assign|update|make|move|put|shift)\b/.test(t) && !/\b(leave|lop|present|absent)\b/.test(t.replace(/half[\s-]?day\s+shift/g, ''))) {
    const pattern = readShiftPattern(t);
    let rest = t;
    for (const w of pattern.dayWordsUsed) rest = rest.replace(w, ' ');
    const dates = readDates(rest, todayKey, { allowDayNames: false });
    const shiftName = (t.match(/\bshift\s+(?:to\s+)?["“']([^"”']{2,40})["”']/) || [])[1] || '';
    return { intent: 'SHIFT', self, pattern: pattern.segments, offDays: pattern.offDays, fromDate: dates.fromDate, toDate: dates.kind === 'RANGE' ? dates.toDate : (dates.kind === 'DAY' && /\b(only|just)\b/.test(t) ? dates.fromDate : null), singleDay: dates.kind === 'DAY' && /\b(on|only|just)\b/.test(t) && !/\bfrom\b/.test(t), shiftName };
  }
  if (/\b(approve|accept|reject|decline|deny)\b/.test(t) && /\b(leave|leaves|wfh|work from home|request|requests)\b/.test(t)) {
    const dates = readDates(t, todayKey);
    return { intent: 'DECIDE_LEAVE', self, decision: /\b(reject|decline|deny)\b/.test(t) ? 'REJECTED' : 'APPROVED', fromDate: dates.fromDate, toDate: dates.toDate, reason: readReason(text) };
  }
  if (/\b(remove|waive|cancel|clear|delete|take off)\b[^.]*\b(lop|loss of pay)\b/.test(t) || (/\b(mark|make|set|treat|count)\b/.test(t) && /\b(present|absent|half[\s-]?day)\b/.test(t) && !/\bleave\b/.test(t))) {
    const dates = readDates(t, todayKey);
    const status = /\b(remove|waive|cancel|clear|delete|take off)\b[^.]*\b(lop|loss of pay)\b/.test(t) ? 'REMOVE_LOP' : /\bhalf[\s-]?day\b/.test(t) ? 'HALF_DAY' : /\babsent\b/.test(t) ? 'ABSENT' : 'PRESENT';
    return { intent: 'MARK_DAY', self, status, fromDate: dates.fromDate, toDate: dates.toDate, days: dates.days, reason: readReason(text) };
  }
  if (/\b(regulari[sz]e|correct|fix|change|update|set)\b/.test(t) && /\b(check[\s-]?in|check[\s-]?out|in[\s-]?time|out[\s-]?time|punch|in|out)\b/.test(t) && new RegExp(TIME_RE).test(t)) {
    const dates = readDates(t.replace(new RegExp(`(?:check[\\s-]?in|check[\\s-]?out|in[\\s-]?time|out[\\s-]?time|\\bin\\b|\\bout\\b|at|to)\\s*(${TIME_RE})`, 'g'), ' '), todayKey);
    return { intent: 'FIX_TIMES', self, fromDate: dates.fromDate, ...readInOut(t), reason: readReason(text) };
  }
  if (/\b(leave|leaves|wfh|work from home|el|cl|sl|comp[\s-]?off|lop)\b/.test(t) && /\b(apply|add|put|record|give|grant|mark|book|take|need|want|request)\b/.test(t)) {
    const dates = readDates(t, todayKey);
    const count = Number((t.match(/\b(\d+(?:\.5)?)\s*(?:day|days)\b/) || [])[1] || 0);
    let toDate = dates.toDate;
    if (dates.kind === 'DAY' && count > 1) toDate = addDays(dates.fromDate, Math.ceil(count) - 1);
    if (dates.kind === 'FROM' && count >= 1) toDate = addDays(dates.fromDate, Math.ceil(count) - 1);
    return { intent: 'APPLY_LEAVE', self, leaveType: readLeaveType(t), dayPart: readDayPart(t), fromDate: dates.fromDate, toDate: toDate || dates.fromDate, reason: readReason(text) };
  }
  return { intent: 'OTHER' };
}

/* ----------------------------------------------------------- Gemini path */

async function parseWithGemini(req, text, todayKey) {
  try {
    const { generate, isAvailable } = require('./ai/geminiClient');
    if (!(await isAvailable(req.tenantId, 'ASSISTANT'))) return null;
    const system = `You read HR requests typed into an HRMS chat. Today is ${todayKey} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekdayOfKey(todayKey)]}), India.
Return ONLY JSON: {"intent": one of SHIFT, APPLY_LEAVE, DECIDE_LEAVE, MARK_DAY, FIX_TIMES, QUESTION, OTHER, "people": [names or employee codes exactly as typed, or "me" for the user], "fromDate", "toDate", "pattern", "offDays", "leaveType", "dayPart", "decision", "status", "checkIn", "checkOut", "reason"}.
- SHIFT: change a shift. pattern = [{"weekdays":[0-6 with 0=Sunday], "startTime":"HH:MM", "endTime":"HH:MM"}], one entry per timing; days not named are the weekly off; omit weekdays when the user gave no days. offDays only for days the user called off. fromDate only if the user named a start day; toDate only if they named an end.
- APPLY_LEAVE: apply leave or WFH for someone (or "me"). leaveType EL, CL, SL, COMP_OFF, LOP or WFH (omit if not said); dayPart FULL, FIRST_HALF or SECOND_HALF; fromDate and toDate.
- DECIDE_LEAVE: approve or reject waiting leave. decision APPROVED or REJECTED.
- MARK_DAY: mark days present / half day / absent, or remove LOP. status PRESENT, HALF_DAY, ABSENT or REMOVE_LOP; fromDate and toDate.
- FIX_TIMES: correct in / out punch times on one day. checkIn / checkOut "HH:MM" (24 h); fromDate.
- QUESTION: the user is asking for information, not asking for a change. OTHER: any other change.
Dates as YYYY-MM-DD. Never invent people, dates or times that were not typed.`;
    const out = await generate({ tenantId: req.tenantId, userId: req.user?._id, feature: 'ASSISTANT', system, prompt: text, json: true, maxOutputTokens: 2048, timeoutMs: 15000 });
    const d = out.data && typeof out.data === 'object' ? out.data : null;
    if (!d || !d.intent) return null;
    return {
      intent: String(d.intent).toUpperCase(),
      people: Array.isArray(d.people) ? d.people.map(String).filter(Boolean).slice(0, 20) : [],
      self: Array.isArray(d.people) && d.people.some((x) => /^(me|myself|i)$/i.test(String(x))),
      pattern: Array.isArray(d.pattern) ? d.pattern.map((x) => ({ weekdays: Array.isArray(x?.weekdays) && x.weekdays.length ? x.weekdays : null, startTime: x?.startTime, endTime: x?.endTime })) : [],
      offDays: Array.isArray(d.offDays) ? d.offDays : [],
      fromDate: /^\d{4}-\d{2}-\d{2}$/.test(String(d.fromDate || '')) ? d.fromDate : null,
      toDate: /^\d{4}-\d{2}-\d{2}$/.test(String(d.toDate || '')) ? d.toDate : null,
      leaveType: d.leaveType ? String(d.leaveType).toUpperCase() : null,
      dayPart: ['FULL', 'FIRST_HALF', 'SECOND_HALF'].includes(String(d.dayPart || '').toUpperCase()) ? String(d.dayPart).toUpperCase() : 'FULL',
      decision: String(d.decision || '').toUpperCase() === 'REJECTED' ? 'REJECTED' : 'APPROVED',
      status: ['PRESENT', 'HALF_DAY', 'ABSENT', 'REMOVE_LOP'].includes(String(d.status || '').toUpperCase()) ? String(d.status).toUpperCase() : null,
      checkIn: shiftPattern.normalizeTime(d.checkIn),
      checkOut: shiftPattern.normalizeTime(d.checkOut),
      reason: String(d.reason || '').slice(0, 200),
      gemini: true
    };
  } catch (_) {
    return null;
  }
}

/* ----------------------------------------------------------- people */

const fullName = (e) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim();
const nameTokens = (e) => `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= 2);

/**
 * People named in the request, matched against every active employee:
 * codes ("OFC0011"), full or partial names ("punit agarwal" finds Punit
 * Agarwala). Returns { people, ambiguous } — ambiguous lists the candidates when
 * one name fits several people.
 */
async function findPeople(req, text, names = []) {
  const all = await Employee.find({ tenantId: req.tenantId, status: { $ne: 'OFFBOARDED' } }).select('employeeCode firstName lastName workLocation department designation userId reportsTo').lean();
  const upper = `${String(text || '')} ${names.join(' ')}`.toUpperCase();
  const byCode = new Map(all.map((e) => [String(e.employeeCode).toUpperCase(), e]));
  const found = [];
  for (const code of upper.match(/\b[A-Z]{1,5}\d{2,6}\b/g) || []) if (byCode.has(code) && !found.includes(byCode.get(code))) found.push(byCode.get(code));
  const sources = names.length ? names : [String(text || '')];
  const ambiguous = [];
  for (const source of sources) {
    const words = String(source).toLowerCase().replace(/'s\b/g, '').split(/[^a-z]+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
    if (!words.length) continue;
    const scored = [];
    for (const e of all) {
      const tokens = nameTokens(e);
      const hits = new Set();
      let firstHit = false;
      tokens.forEach((tok, i) => {
        const w = words.find((x) => x === tok || (x.length >= 4 && tok.startsWith(x)) || (tok.length >= 4 && x.startsWith(tok)));
        if (w) { hits.add(w); if (i === 0) firstHit = true; }
      });
      if (hits.size >= 2 || (hits.size === 1 && firstHit)) scored.push({ e, hits, score: hits.size });
    }
    if (!scored.length) continue;
    // Drop people whose matched words are all inside someone else's better match.
    const kept = scored.filter((a) => !scored.some((b) => b !== a && b.score > a.score && [...a.hits].every((w) => b.hits.has(w))));
    const groups = new Map();
    for (const k of kept) {
      const key = [...k.hits].sort().join(' ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(k.e);
    }
    for (const list of groups.values()) {
      if (list.length === 1) { if (!found.includes(list[0])) found.push(list[0]); } else ambiguous.push(list);
    }
  }
  return { people: found, ambiguous };
}

async function inScope(req, employees, resource) {
  const allowed = new Set((await getScopedEmployeeIds({ user: req.user, employee: req.employee, resource })).map(String));
  return employees.filter((e) => !allowed.has(String(e._id)));
}

const isAdmin = (user) => ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);

/* ----------------------------------------------------------- answers */

const deny = (what) => ({ kind: 'DENIED', answer: `You don't have permission to ${what}. ${ASK_ADMIN}`, intent: 'ACTION_DENIED', denied: true });
const ask = (answer) => ({ kind: 'ASK', answer, intent: 'ACTION_NEEDS_DETAIL', needsClarification: true });

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Fri 27 Nov 2026" (or "Fri 27 Nov"). */
function dayLabel(key, { year = true } = {}) {
  const d = new Date(`${key}T00:00:00.000Z`);
  return `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}
function rangeLabel(from, to) {
  if (!to || to === from) return dayLabel(from);
  return `${dayLabel(from, { year: from.slice(0, 4) !== to.slice(0, 4) })} – ${dayLabel(to)}`;
}
const personLabel = (e) => `${fullName(e)} (${e.employeeCode})`;
const listPeople = (list) => list.map(personLabel).join(', ');

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', `${env.jwtSecret}:hr-chat-action`).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function unsign(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', `${env.jwtSecret}:hr-chat-action`).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { return null; }
}

function preview(req, { title, lines, confirmLabel, action, note, steps, danger }) {
  const token = sign({ t: String(req.tenantId), u: String(req.user._id), x: Date.now() + TOKEN_LIFE_MS, n: crypto.randomBytes(9).toString('base64url'), a: action });
  return {
    kind: 'PREVIEW',
    intent: 'ACTION_PREVIEW',
    answer: `${title}. Check the details and press ${confirmLabel} to save it.`,
    action: { token, title, lines: lines || [], confirmLabel, note: note || '', ...(steps ? { steps } : {}), ...(danger ? { danger: true } : {}) }
  };
}

/* ----------------------------------------------------------- tasks */

const canManageShifts = (user) => isAdmin(user) || hasAbility(user, 'SHIFTS', 'MANAGE');

async function whoFor(req, parsed, resource, { allowSelf = true } = {}) {
  const { people, ambiguous } = await findPeople(req, parsed.text, parsed.people || []);
  if (ambiguous.length) {
    const options = ambiguous[0].map(personLabel).join(', or ');
    return { error: ask(`More than one person matches. Did you mean ${options}? Write the employee code to be sure.`) };
  }
  let list = people;
  if (!list.length && parsed.self && allowSelf) {
    if (!req.employee) return { error: ask('Your login is not linked to an employee profile, so I can\'t tell whose record you mean. Write the person\'s name or employee code.') };
    list = [req.employee];
  }
  if (!list.length) return { error: null, list: [] };
  const outside = await inScope(req, list, resource);
  if (outside.length) {
    return { error: { kind: 'DENIED', intent: 'ACTION_DENIED', denied: true, answer: `${listPeople(outside)} ${outside.length === 1 ? 'is' : 'are'} outside the people you are allowed to manage. ${ASK_ADMIN}` } };
  }
  return { error: null, list };
}

async function currentWorkDays(tenantId, employee, todayKey) {
  const row = await latestAssignmentOn({ tenantId, employeeId: employee._id, day: new Date(`${todayKey}T00:00:00.000Z`) });
  const off = Array.isArray(row?.shiftId?.weeklyOffDays) && row.shiftId.weeklyOffDays.length ? row.shiftId.weeklyOffDays.map(Number) : [0];
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !off.includes(d));
}

async function planShift(req, parsed, todayKey) {
  if (!canManageShifts(req.user)) {
    return deny(parsed.self && !(parsed.people || []).length ? 'change shifts, including your own' : 'change shifts');
  }
  const { error, list } = await whoFor(req, parsed, 'EMPLOYEE_PROFILE');
  if (error) return error;
  if (!list.length) return ask('Whose shift should I change? Write their name or employee code, for example "change Punit Agarwala\'s shift Monday to Friday 10:30 am to 6:30 pm and Saturday 10:30 am to 3:30 pm".');
  let segments = (parsed.pattern || []).filter((s) => s.startTime && s.endTime);
  if (!segments.length && parsed.shiftName) {
    const shift = await Shift.findOne({ tenantId: req.tenantId, active: { $ne: false }, $or: [{ name: new RegExp(`^${parsed.shiftName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') }, { code: new RegExp(`^${parsed.shiftName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] }).lean();
    if (shift) segments = [{ weekdays: null, startTime: shift.startTime, endTime: shift.endTime }];
  }
  if (!segments.length) return ask('What should the new timing be? For example "Monday to Friday 10:30 am to 6:30 pm and Saturday 10:30 am to 3:30 pm".');
  if (segments.filter((s) => !s.weekdays).length > 1) return ask('Which days is each timing for? For example "Monday to Friday 10:30 am to 6:30 pm and Saturday 10:30 am to 3:30 pm".');
  // A timing given without days keeps the person's present weekly off (usually Sunday).
  const named = new Set(segments.flatMap((s) => s.weekdays || []));
  const blank = segments.find((s) => !s.weekdays);
  if (blank) {
    const work = await currentWorkDays(req.tenantId, list[0], todayKey);
    const offDays = new Set((parsed.offDays || []).map(Number));
    blank.weekdays = work.filter((d) => !named.has(d) && !offDays.has(d));
    if (!blank.weekdays.length) blank.weekdays = [1, 2, 3, 4, 5, 6].filter((d) => !named.has(d));
  }
  let fromDate = parsed.fromDate || todayKey;
  let toDate = parsed.toDate || (parsed.singleDay ? fromDate : null);
  if (toDate && toDate < fromDate) [fromDate, toDate] = [toDate, fromDate];
  let planned;
  try {
    planned = await shiftPattern.plan({ tenantId: req.tenantId, employees: list, segments, offDays: parsed.offDays || [], fromDate, toDate });
  } catch (err) {
    if (err.statusCode === 400 || err.status === 400) return ask(err.message);
    throw err;
  }
  const lines = [
    { label: list.length === 1 ? 'Person' : 'People', value: listPeople(list) },
    { label: 'New shift', value: planned.label },
    { label: toDate ? 'Dates' : 'From', value: toDate ? rangeLabel(planned.fromDate, planned.toDate) : `${dayLabel(planned.fromDate)} onwards` }
  ];
  if (planned.newShifts.length) lines.push({ label: 'New shift made', value: planned.newShifts.join(', ') });
  const replaced = planned.people.reduce((t, p) => t + p.replaced, 0);
  if (replaced) lines.push({ label: 'Replaces', value: `${replaced} shift setting${replaced === 1 ? '' : 's'} already saved from that day on` });
  const note = planned.recalculates ? `Attendance from ${dayLabel(planned.fromDate)} to today is worked out again with the new shift, and the payroll draft follows.` : '';
  return preview(req, {
    title: `Change ${list.length === 1 ? `${fullName(list[0])}'s` : `${list.length} people's`} shift`,
    lines,
    note,
    confirmLabel: 'Change shift',
    action: { intent: 'SHIFT', employeeIds: list.map((e) => String(e._id)), segments: planned.parts.map((p) => ({ weekdays: p.workDays, startTime: p.shift.startTime, endTime: p.shift.endTime })), offDays: planned.offDays, fromDate: planned.fromDate, toDate: planned.toDate, text: parsed.text.slice(0, 300) }
  });
}

async function leaveBalanceLeft(tenantId, employeeId, leaveType) {
  const [balance, pending] = await Promise.all([
    LeaveBalance.findOne({ tenantId, employeeId, leaveType }),
    LeaveRequest.find({ tenantId, employeeId, leaveType, requestType: 'LEAVE', status: 'PENDING' }).select('days').lean()
  ]);
  const available = Number(balance?.toJSON?.().available ?? balance?.available ?? 0);
  return { available, pending: pending.reduce((t, r) => t + Number(r.days || 0), 0) };
}

const LEAVE_NAMES = { EL: 'Earned leave (EL)', CL: 'Casual leave (CL)', SL: 'Sick leave (SL)', COMP_OFF: 'Comp off', LOP: 'Leave without pay (LOP)', WFH: 'Work from home' };

async function planApplyLeave(req, parsed, todayKey) {
  const { error, list } = await whoFor(req, parsed, 'LEAVE');
  if (error) return error;
  let people = list;
  if (!people.length) {
    if (!req.employee) return ask('Who is the leave for? Write their name or employee code.');
    people = [req.employee];
  }
  if (people.length > 1) return ask('I can apply leave for one person at a time. Write one name.');
  const employee = people[0];
  const self = Boolean(req.employee && String(req.employee._id) === String(employee._id));
  if (!self && !isAdmin(req.user) && !hasAbility(req.user, 'LEAVE', 'APPLY_ON_BEHALF') && !(await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: employee }))) {
    return deny('apply leave for other people');
  }
  if (!parsed.fromDate) return ask(`Which day${parsed.dayPart === 'FULL' ? '(s)' : ''} should the leave be for? For example "on 30 Nov" or "from 1 Dec to 3 Dec".`);
  const leaveType = parsed.leaveType || 'EL';
  const requestType = leaveType === 'WFH' ? 'WFH' : 'LEAVE';
  let fromDate = parsed.fromDate;
  let toDate = parsed.toDate || parsed.fromDate;
  if (toDate < fromDate) [fromDate, toDate] = [toDate, fromDate];
  const dayPart = fromDate === toDate ? (parsed.dayPart || 'FULL') : 'FULL';
  const days = dayPart === 'FULL' ? Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000) + 1 : 0.5;
  if (requestType === 'LEAVE' && leaveType !== 'LOP') {
    const { available, pending } = await leaveBalanceLeft(req.tenantId, employee._id, leaveType);
    if (available - pending < days) {
      return ask(`${fullName(employee)} has ${available - pending} day(s) of ${leaveType} left${pending ? ` (${pending} more already waiting for approval)` : ''}, not enough for ${days}. Choose another leave type, for example "apply LOP for … on …".`);
    }
  }
  const { submitterCanApprove } = require('../controllers/leaveController');
  const autoApprove = await submitterCanApprove(req, employee, !self);
  const manager = autoApprove ? null : await getReportingManager(employee);
  const lines = [
    { label: 'For', value: personLabel(employee) },
    { label: 'Type', value: LEAVE_NAMES[leaveType] || leaveType },
    { label: 'Dates', value: `${rangeLabel(fromDate, toDate)} · ${days} day${days === 1 ? '' : 's'}${dayPart === 'FIRST_HALF' ? ' (first half)' : dayPart === 'SECOND_HALF' ? ' (second half)' : ''}` },
    { label: 'Approval', value: autoApprove ? 'Approved at once (you can approve it)' : `Sent to ${manager ? fullName(manager) : 'HR'} for approval` }
  ];
  const reason = parsed.reason || (self ? 'Applied from the HR chat' : `Applied from the HR chat by ${req.user.name || 'HR'}`);
  if (parsed.reason) lines.push({ label: 'Reason', value: parsed.reason });
  return preview(req, {
    title: `${requestType === 'WFH' ? 'Work from home' : 'Leave'} for ${self ? 'you' : fullName(employee)}`,
    lines,
    confirmLabel: autoApprove ? 'Apply and approve' : 'Apply leave',
    note: autoApprove ? 'Attendance shows it at once and the payroll draft follows.' : '',
    action: { intent: 'APPLY_LEAVE', employeeId: String(employee._id), self, leaveType, requestType, fromDate, toDate, dayPart, reason }
  });
}

async function planDecideLeave(req, parsed) {
  const { error, list } = await whoFor(req, parsed, 'LEAVE', { allowSelf: false });
  if (error) return error;
  if (!list.length) return ask('Whose leave should I decide? Write their name or employee code.');
  if (list.length > 1) return ask('Decide leave for one person at a time. Write one name.');
  const employee = list[0];
  if (req.employee && String(req.employee._id) === String(employee._id) && req.user.role !== 'SUPER_ADMIN') {
    return { kind: 'DENIED', intent: 'ACTION_DENIED', denied: true, answer: `You can't approve or reject your own leave. It goes to your reporting manager or HR.` };
  }
  const can = isAdmin(req.user) || hasAbility(req.user, 'LEAVE', 'APPROVE') || await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: employee });
  if (!can) return deny(`approve or reject ${fullName(employee)}'s leave`);
  const q = { tenantId: req.tenantId, employeeId: employee._id, status: 'PENDING' };
  if (parsed.fromDate) { q.fromDate = { $lte: new Date(`${parsed.toDate || parsed.fromDate}T23:59:59.999Z`) }; q.toDate = { $gte: new Date(`${parsed.fromDate}T00:00:00.000Z`) }; }
  const pending = await LeaveRequest.find(q).sort('fromDate').limit(10).lean();
  if (!pending.length) return { kind: 'ASK', intent: 'ACTION_NOTHING_TO_DO', answer: `${fullName(employee)} has no leave waiting for a decision${parsed.fromDate ? ` on ${rangeLabel(parsed.fromDate, parsed.toDate)}` : ''}.` };
  const lines = [{ label: 'Person', value: personLabel(employee) }, ...pending.map((r) => ({ label: r.requestType === 'WFH' ? 'WFH' : r.leaveType, value: `${rangeLabel(dateKey(r.fromDate), dateKey(r.toDate))} · ${r.days} day${Number(r.days) === 1 ? '' : 's'}${r.reason ? ` · "${String(r.reason).slice(0, 60)}"` : ''}` }))];
  const approve = parsed.decision !== 'REJECTED';
  return preview(req, {
    title: `${approve ? 'Approve' : 'Reject'} ${fullName(employee)}'s ${pending.length === 1 ? 'request' : `${pending.length} requests`}`,
    lines,
    confirmLabel: approve ? 'Approve' : 'Reject',
    action: { intent: 'DECIDE_LEAVE', employeeId: String(employee._id), requestIds: pending.map((r) => String(r._id)), decision: approve ? 'APPROVED' : 'REJECTED', reason: parsed.reason || '' }
  });
}

const MARK_WORDS = { PRESENT: 'present (full day, no LOP)', HALF_DAY: 'half day (0.5 LOP)', ABSENT: 'absent (1 day LOP)', REMOVE_LOP: 'LOP removed (the day stays as it is)' };

async function planMarkDay(req, parsed, todayKey) {
  if (!isAdmin(req.user) && !hasAbility(req.user, 'ATTENDANCE', 'OVERRIDE')) return deny('change attendance or LOP');
  const { error, list } = await whoFor(req, parsed, 'ATTENDANCE');
  if (error) return error;
  if (!list.length) return ask('Whose attendance should I change? Write their name or employee code.');
  if (list.length > 1) return ask('Change one person\'s attendance at a time. Write one name.');
  if (!parsed.fromDate) return ask('Which day? For example "on 12 Nov" or "from 10 Nov to 12 Nov".');
  let from = parsed.fromDate;
  let to = parsed.toDate || from;
  if (to < from) [from, to] = [to, from];
  const days = Array.isArray(parsed.days) && parsed.days.length > 2 ? parsed.days.slice().sort() : [];
  if (!days.length) for (let d = from; d <= to && days.length < 32; d = addDays(d, 1)) days.push(d);
  if (days.length > 31) return ask('Change at most a month at a time.');
  if (days.some((d) => d > todayKey)) return ask('Attendance can only be changed for days that have already happened.');
  const status = parsed.status || 'PRESENT';
  const employee = list[0];
  return preview(req, {
    title: `${status === 'REMOVE_LOP' ? 'Remove LOP for' : 'Change attendance for'} ${fullName(employee)}`,
    lines: [
      { label: 'Person', value: personLabel(employee) },
      { label: days.length === 1 ? 'Day' : 'Days', value: days.length <= 3 ? days.map((d) => dayLabel(d)).join(', ') : `${rangeLabel(days[0], days[days.length - 1])} · ${days.length} days` },
      { label: 'Becomes', value: MARK_WORDS[status] }
    ],
    note: 'Days on leave, work from home or a holiday are left as they are. The payroll draft follows.',
    confirmLabel: status === 'REMOVE_LOP' ? 'Remove LOP' : 'Save',
    action: { intent: 'MARK_DAY', employeeId: String(employee._id), days, status, reason: parsed.reason || '' }
  });
}

async function planFixTimes(req, parsed, todayKey) {
  const { error, list } = await whoFor(req, parsed, 'ATTENDANCE');
  if (error) return error;
  let people = list;
  if (!people.length) {
    if (!req.employee) return ask('Whose in / out time should I correct? Write their name or employee code.');
    people = [req.employee];
  }
  if (people.length > 1) return ask('Correct one person\'s times at a time.');
  const employee = people[0];
  const self = Boolean(req.employee && String(req.employee._id) === String(employee._id));
  if (!self && !isAdmin(req.user) && !hasAbility(req.user, 'REGULARIZATION', 'APPLY_ON_BEHALF') && !(await canApproveEmployee({ user: req.user, employee: req.employee, targetEmployee: employee }))) {
    return deny('correct other people\'s in / out times');
  }
  if (!parsed.fromDate) return ask('Which day? For example "on 12 Nov".');
  if (parsed.fromDate > todayKey) return ask('Times can only be corrected for days that have already happened.');
  if (!parsed.checkIn && !parsed.checkOut) return ask('What should the in or out time be? For example "out time 6:15 pm".');
  const approver = self && req.user.role !== 'SUPER_ADMIN';
  return preview(req, {
    title: `Correct ${self ? 'your' : `${fullName(employee)}'s`} time on ${dayLabel(parsed.fromDate, { year: false })}`,
    lines: [
      { label: 'Person', value: personLabel(employee) },
      { label: 'Day', value: dayLabel(parsed.fromDate) },
      ...(parsed.checkIn ? [{ label: 'In', value: shiftPattern.timeLabel(parsed.checkIn) }] : []),
      ...(parsed.checkOut ? [{ label: 'Out', value: shiftPattern.timeLabel(parsed.checkOut) }] : []),
      { label: 'Approval', value: approver ? 'Sent to your approver' : 'Saved at once' }
    ],
    confirmLabel: approver ? 'Send request' : 'Save times',
    action: { intent: 'FIX_TIMES', employeeId: String(employee._id), date: parsed.fromDate, checkIn: parsed.checkIn, checkOut: parsed.checkOut, reason: parsed.reason || '' }
  });
}

/**
 * The chat's first look at a message. Returns null when it is a question (the
 * normal answers handle it), else a refusal, a follow-up question or a preview.
 */
async function handleAssistantMessage(req, text) {
  const message = String(text || '').trim();
  if (!looksLikeAction(message)) return null;
  const todayKey = dateKey(companyToday());
  let parsed = parseRules(message, todayKey);
  const gemini = await parseWithGemini(req, message, todayKey);
  if (gemini && ['SHIFT', 'APPLY_LEAVE', 'DECIDE_LEAVE', 'MARK_DAY', 'FIX_TIMES'].includes(gemini.intent)) {
    // Gemini reads the wording; the rules fill anything it left out.
    const rules = parsed.intent === gemini.intent ? parsed : {};
    parsed = {
      ...rules,
      ...Object.fromEntries(Object.entries(gemini).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length) && v !== '')),
      intent: gemini.intent,
      self: Boolean(gemini.self || rules.self)
    };
    if (gemini.intent === 'SHIFT' && (!gemini.pattern || !gemini.pattern.length) && rules.pattern) parsed.pattern = rules.pattern;
  } else if (gemini && gemini.intent === 'QUESTION' && parsed.intent === 'OTHER') {
    return null;
  }
  parsed.text = message;
  switch (parsed.intent) {
    case 'SHIFT': return planShift(req, parsed, todayKey);
    case 'APPLY_LEAVE': return planApplyLeave(req, parsed, todayKey);
    case 'DECIDE_LEAVE': return planDecideLeave(req, parsed, todayKey);
    case 'MARK_DAY': return planMarkDay(req, parsed, todayKey);
    case 'FIX_TIMES': return planFixTimes(req, parsed, todayKey);
    default:
      return null;
  }
}

/** "Confirm" pressed: checks the token and the permission again, then saves. */
async function confirmAssistantAction(req, token) {
  const payload = unsign(token);
  if (!payload || payload.t !== String(req.tenantId) || payload.u !== String(req.user._id)) throw new ApiError(400, 'This confirmation is not valid any more. Ask again.');
  if (Date.now() > Number(payload.x)) throw new ApiError(400, 'This confirmation has expired. Ask again.');
  for (const [nonce, until] of usedTokens) if (until < Date.now()) usedTokens.delete(nonce);
  if (usedTokens.has(payload.n)) throw new ApiError(409, 'This was already done.');
  usedTokens.set(payload.n, Number(payload.x));
  const a = payload.a || {};
  req.aiSource = 'AI';
  try {
    // The Super Admin's operations: API calls, run through the same routes as the screens.
    if (a.intent === 'OPERATE') return await require('./assistantOperatorService').executeSteps(req, a);
    if (a.intent === 'SHIFT') {
      if (!canManageShifts(req.user)) return deny('change shifts');
      const employees = await Employee.find({ tenantId: req.tenantId, _id: { $in: a.employeeIds } });
      const outside = await inScope(req, employees, 'EMPLOYEE_PROFILE');
      if (outside.length || employees.length !== a.employeeIds.length) return deny('change these people\'s shifts');
      const done = await shiftPattern.apply(req, { employees, segments: a.segments, offDays: a.offDays, fromDate: a.fromDate, toDate: a.toDate, reason: `HR chat: ${a.text || ''}`.trim() });
      const who = employees.length === 1 ? `${fullName(employees[0])}'s` : `${employees.length} people's`;
      const recalc = done.recalculated?.reevaluated ? ` ${done.recalculated.reevaluated} day${done.recalculated.reevaluated === 1 ? '' : 's'} of attendance worked out again.` : '';
      return { kind: 'DONE', intent: 'ACTION_DONE', done: true, answer: `Done. ${who} shift is now ${done.label}, ${done.toDate ? rangeLabel(done.fromDate, done.toDate) : `from ${dayLabel(done.fromDate)} onwards`}.${recalc}` };
    }
    if (a.intent === 'APPLY_LEAVE') {
      const { submitLeaveRequest } = require('../controllers/leaveController');
      const out = await submitLeaveRequest(req, { employeeId: a.self ? undefined : a.employeeId, requestType: a.requestType, leaveType: a.leaveType, fromDate: a.fromDate, toDate: a.toDate, dayPart: a.dayPart, reason: a.reason });
      const employee = await Employee.findById(a.employeeId).select('firstName lastName').lean();
      const what = `${a.requestType === 'WFH' ? 'Work from home' : a.leaveType} on ${rangeLabel(a.fromDate, a.toDate)}`;
      return { kind: 'DONE', intent: 'ACTION_DONE', done: true, answer: out.autoApproved ? `Done. ${what} is recorded and approved for ${a.self ? 'you' : fullName(employee)}.` : `Done. ${what} is sent for approval.` };
    }
    if (a.intent === 'DECIDE_LEAVE') {
      const { decideLeaveRequest } = require('../controllers/leaveController');
      const settled = [];
      for (const id of a.requestIds || []) {
        const { request } = await decideLeaveRequest(req, id, { status: a.decision, remarks: a.reason || 'Decided from the HR chat' });
        settled.push(request);
      }
      if (settled.length) {
        const { settleAttendanceChange } = require('./attendanceChangeService');
        await settleAttendanceChange(req, { employeeIds: [a.employeeId], dates: settled.flatMap((r) => [r.fromDate, r.toDate]) }).catch(() => null);
      }
      return { kind: 'DONE', intent: 'ACTION_DONE', done: true, answer: `Done. ${settled.length} request${settled.length === 1 ? '' : 's'} ${a.decision === 'APPROVED' ? 'approved' : 'rejected'}; the person is told.` };
    }
    if (a.intent === 'MARK_DAY') {
      const { runDayAction } = require('./attendanceDayActionService');
      const reason = a.reason || `Changed from the HR chat by ${req.user.name || 'HR'}`;
      const changed = [];
      const skipped = [];
      let last = null;
      for (const date of a.days || []) {
        try {
          last = await runDayAction(req, a.status === 'REMOVE_LOP' ? { action: 'REMOVE_LOP', employeeId: a.employeeId, date, reason } : { action: 'MARK', status: a.status, employeeId: a.employeeId, date, reason });
          changed.push(date);
        } catch (err) {
          if (err.statusCode === 403 || err.status === 403) throw err;
          skipped.push(`${dayLabel(date, { year: false })}: ${err.message}`);
        }
      }
      const lop = last?.summary?.lopDays;
      const bits = [`Done. ${changed.length} day${changed.length === 1 ? '' : 's'} ${a.status === 'REMOVE_LOP' ? 'without LOP now' : `marked ${MARK_WORDS[a.status].split(' (')[0]}`}.`];
      if (lop !== undefined) bits.push(`LOP this month: ${lop} day${lop === 1 ? '' : 's'}.`);
      if (skipped.length) bits.push(`Not changed — ${skipped.join('; ')}`);
      return { kind: 'DONE', intent: 'ACTION_DONE', done: true, answer: bits.join(' ') };
    }
    if (a.intent === 'FIX_TIMES') {
      const { runDayAction } = require('./attendanceDayActionService');
      const out = await runDayAction(req, { action: 'SET_TIMES', employeeId: a.employeeId, date: a.date, checkIn: a.checkIn ? `${a.date}T${a.checkIn}` : undefined, checkOut: a.checkOut ? `${a.date}T${a.checkOut}` : undefined, reason: a.reason || `Corrected from the HR chat by ${req.user.name || 'HR'}` });
      return { kind: 'DONE', intent: 'ACTION_DONE', done: true, answer: `Done. ${out.message}` };
    }
    throw new ApiError(400, 'This confirmation is not valid any more. Ask again.');
  } catch (err) {
    usedTokens.delete(payload.n);
    if (err.statusCode === 403 || err.status === 403) return { kind: 'DENIED', intent: 'ACTION_DENIED', denied: true, answer: `${err.message}. ${ASK_ADMIN}` };
    throw err;
  }
}

module.exports = { handleAssistantMessage, confirmAssistantAction, looksLikeAction, parseRules, readShiftPattern, readDates, findPeople, timeRangeFrom, preview, ASK_ADMIN };
