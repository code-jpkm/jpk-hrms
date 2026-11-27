const Employee = require('../models/Employee');
const { generate, isAvailable } = require('./ai/geminiClient');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const SalarySlip = require('../models/SalarySlip');
const Holiday = require('../models/Holiday');
const { getScopedEmployeeIds } = require('./scopeService');
const { startOfDay, endOfDay, dateKey, holidayDateKey } = require('../utils/date');
const { hasAbility } = require('../middleware/auth');

/**
 * Read-only HR question answering for the corner chat.
 *
 * Deliberately NOT a general agent. It resolves the question to one of a small
 * set of intents, answers from the database, and never writes anything. Write
 * operations stay behind /api/ai/command, which has permission checks, a
 * dry-run preview and an audit trail.
 *
 * Every lookup is filtered through the caller's own scope, so the chat can
 * never surface a person the user could not already open in the directory.
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fullName(e) {
  return `${e?.firstName || ''} ${e?.lastName || ''}`.trim();
}

function timeOf(value, offsetMinutes = 330) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata'
  });
}

/** Match a person by name fragment or employee code, within the caller's scope. */
async function findPerson({ tenantId, question, allowedIds }) {
  const cleaned = question.replace(/[?.,!]/g, ' ');
  const code = cleaned.match(/\b([A-Z]{2,5}\d{3,6})\b/);
  const base = { tenantId, _id: { $in: allowedIds } };

  if (code) {
    const byCode = await Employee.findOne({ ...base, employeeCode: new RegExp(`^${code[1]}$`, 'i') });
    if (byCode) return byCode;
  }

  const stop = new Set([
    'is', 'was', 'are', 'the', 'and', 'for', 'her', 'his', 'their', 'what', 'when', 'who', 'how', 'many',
    'present', 'absent', 'today', 'yesterday', 'time', 'in', 'out', 'check', 'leave', 'on', 'did', 'does',
    'come', 'came', 'salary', 'payslip', 'net', 'pay', 'this', 'month', 'last', 'tell', 'me', 'please',
    'show', 'give', 'of', 'a', 'an', 'at', 'to', 'he', 'she', 'they', 'employee', 'staff', 'attendance'
  ]);
  const words = cleaned.split(/\s+/).map((w) => w.trim()).filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  if (!words.length) return null;

  const candidates = await Employee.find({
    ...base,
    $or: words.flatMap((w) => ([
      { firstName: new RegExp(`^${escapeRegex(w)}`, 'i') },
      { lastName: new RegExp(`^${escapeRegex(w)}`, 'i') }
    ]))
  }).limit(6);

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    // Prefer an exact first-name hit before giving up as ambiguous.
    const exact = candidates.filter((c) => words.some((w) => c.firstName?.toLowerCase() === w.toLowerCase()));
    if (exact.length === 1) return exact[0];
    return { ambiguous: candidates };
  }
  return null;
}

/** Every date mentioned, so a question naming two days can answer for both. */
function resolveDates(question, now = new Date()) {
  const q = question.toLowerCase();
  const out = [];
  const monthName = MONTHS.find((m) => q.includes(m));
  // "15th august", "15 aug", and bare "15th or 14th august"
  for (const m of q.matchAll(/(\d{1,2})\s*(?:st|nd|rd|th)?(?:\s+of)?\s*([a-z]+)?/g)) {
    const day = Number(m[1]);
    if (!day || day > 31) continue;
    const mon = (m[2] && MONTHS.indexOf(m[2]) > -1) ? MONTHS.indexOf(m[2]) : (monthName ? MONTHS.indexOf(monthName) : -1);
    if (mon < 0) continue;
    const d = new Date(now.getFullYear(), mon, day);
    if (!out.some((x) => x.getTime() === d.getTime())) out.push(d);
  }
  for (const m of q.matchAll(/(20\d{2})-(\d{1,2})-(\d{1,2})/g)) {
    out.push(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  if (!out.length) out.push(resolveDate(question, now));
  return out;
}

function resolveDate(question, now = new Date()) {
  const q = question.toLowerCase();
  if (/day after tomorrow/.test(q)) return new Date(now.getTime() + 2 * 86400000);
  if (/tomorrow/.test(q)) return new Date(now.getTime() + 86400000);
  if (/yesterday/.test(q)) return new Date(now.getTime() - 86400000);
  const dm = q.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)/);
  if (dm && MONTHS.indexOf(dm[2]) > -1) {
    return new Date(now.getFullYear(), MONTHS.indexOf(dm[2]), Number(dm[1]));
  }
  const iso = q.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return now;
}

function classify(question) {
  const q = question.toLowerCase();
  // Holiday questions must be caught FIRST. Previously "is 15th August a
  // holiday?" fell through to person lookup and answered "I could not find
  // that person", because /holiday/ only appeared inside the LEAVE branch.
  if (/\b(holiday|festival|is\s+.*\ba\s+holiday|off\s+day|working\s+day)\b/.test(q)
      && !/\b(leave|applied|approve)\b/.test(q)) return 'HOLIDAY';
  if (/\bwho\b.*\b(absent|not present|missing)\b|\b(absent|not present)\b.*\b(team|department|sales|marketing|accounts|production|quality|dispatch|hr|mis)\b/.test(q)) return 'ABSENT_LIST';
  if (/\bhow many\b.*\b(present|absent|leave)\b|\bheadcount\b|\btoday'?s attendance\b/.test(q)) return 'COUNT';
  if (/\b(birthday|born|birth date)\b/.test(q)) return 'BIRTHDAY';
  if (/\b(work anniversary|anniversary|years? (?:with|in) (?:the )?(?:company|organisation|organization|jpk))\b/.test(q)) return 'ANNIVERSARY';
  if (/\b(in\s*time|check\s*in|came? in|arriv)/.test(q)) return 'IN_TIME';
  if (/\b(out\s*time|check\s*out|left|went home)/.test(q)) return 'OUT_TIME';
  if (/\b(present|absent|attendance|on duty|working)\b/.test(q)) return 'PRESENCE';
  if (/\b(leave|off|holiday|vacation)\b/.test(q)) return 'LEAVE';
  if (/\b(salary|payslip|net pay|paid)\b/.test(q)) return 'SALARY';
  return 'UNKNOWN';
}

async function answerHrQuestion({ tenantId, user, employee, question }) {
  // Only used for calendar arithmetic ("today", "tomorrow", "15th august"):
  // shift to the India wall clock so the UTC server never answers for
  // yesterday between midnight and 05:30 IST.
  const now = new Date(Date.now() + Number(process.env.HRMS_TIMEZONE_OFFSET_MINUTES || 330) * 60000);
  const intent = classify(question);
  const date = resolveDate(question, now);
  const day = startOfDay(date);

  if (intent === 'HOLIDAY') {
    const dates = resolveDates(question, now);
    const lines = [];
    for (const d of dates) {
      const dayStart = startOfDay(d);
      const probeFrom = new Date(dayStart.getTime() - 86400000);
      const probeTo = new Date(endOfDay(dayStart).getTime() + 86400000);
      const holidayRows = await Holiday.find({ tenantId, date: { $gte: probeFrom, $lte: probeTo } });
      const found = holidayRows.find((h) => holidayDateKey(h) === dateKey(dayStart));
      lines.push(found
        ? `${dateKey(dayStart)} is ${found.name}${found.optional ? ' (optional)' : ''}.`
        : `${dateKey(dayStart)} is not a holiday.`);
    }
    return { answer: lines.join(' '), intent, facts: { dates: dates.map((d) => dateKey(startOfDay(d))) } };
  }

  const allowedIds = await getScopedEmployeeIds({ user, employee, resource: 'ATTENDANCE' });

  if (intent === 'ABSENT_LIST') {
    const probeHolidays = await Holiday.find({ tenantId, date: { $gte: new Date(day.getTime() - 86400000), $lte: new Date(endOfDay(day).getTime() + 86400000) } });
    const dayHoliday = probeHolidays.find((h) => holidayDateKey(h) === dateKey(day));
    if (dayHoliday) return { answer: `${dateKey(day)} is ${dayHoliday.name}, so employees are not counted absent for the holiday.`, intent };

    const teamMatch = question.match(/(?:in|from|of)\s+(?:the\s+)?([a-z][a-z &-]{1,30}?)(?:\s+team|\s+department)?(?:\?|$)/i);
    const commonDepartment = question.match(/\b(sales(?:\s*&\s*marketing)?|marketing|accounts?|production|quality|dispatch|hr|human resources|mis|maintenance|pattern|purchase)\b/i);
    const team = String(commonDepartment?.[1] || teamMatch?.[1] || '').trim();
    const employeeQuery = { tenantId, _id: { $in: allowedIds }, status: { $ne: 'OFFBOARDED' } };
    if (team) employeeQuery.department = new RegExp(team.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const people = await Employee.find(employeeQuery).select('firstName lastName employeeCode department');
    const ids = people.map((e) => e._id);
    const [rows, leaves] = await Promise.all([
      Attendance.find({ tenantId, employeeId: { $in: ids }, date: day }).select('employeeId status checkIn'),
      LeaveRequest.find({ tenantId, employeeId: { $in: ids }, status: 'APPROVED', fromDate: { $lte: endOfDay(day) }, toDate: { $gte: day } }).select('employeeId')
    ]);
    const presentIds = new Set(rows.filter((r) => r.checkIn || ['PRESENT','WFH','HALF_DAY'].includes(r.status)).map((r) => String(r.employeeId)));
    const leaveIds = new Set(leaves.map((l) => String(l.employeeId)));
    const absent = people.filter((e) => !presentIds.has(String(e._id)) && !leaveIds.has(String(e._id)));
    const scopeLabel = team ? `${team} team` : 'your attendance scope';
    if (!people.length) return { answer: `I could not find any active employees in the ${scopeLabel} that you have access to.`, intent };
    if (!absent.length) return { answer: `No one is currently absent in the ${scopeLabel} on ${dateKey(day)}.`, intent, facts: { absent: 0, team } };
    return { answer: `${absent.length} ${absent.length === 1 ? 'person is' : 'people are'} absent in the ${scopeLabel} on ${dateKey(day)}: ${absent.map((e) => `${fullName(e)} (${e.employeeCode})`).join(', ')}.`, intent, facts: { absent: absent.length, team, names: absent.map(fullName) } };
  }

  if (intent === 'BIRTHDAY' || intent === 'ANNIVERSARY') {
    const people = await Employee.find({ tenantId, _id: { $in: allowedIds }, status: { $ne: 'OFFBOARDED' } })
      .select('firstName lastName employeeCode dateOfBirth dateOfJoining department');
    const field = intent === 'BIRTHDAY' ? 'dateOfBirth' : 'dateOfJoining';
    const todayOnly = startOfDay(now);
    const upcoming = people.map((e) => {
      const key = e[field] ? require('../utils/date').semanticDateKey(e[field]) : '';
      if (!key) return null;
      const [, month, d] = key.split('-').map(Number);
      let occurrence = new Date(todayOnly.getFullYear(), month - 1, d);
      if (occurrence < todayOnly) occurrence = new Date(todayOnly.getFullYear() + 1, month - 1, d);
      const daysAway = Math.round((occurrence - todayOnly) / 86400000);
      const years = intent === 'ANNIVERSARY' ? occurrence.getFullYear() - Number(key.slice(0, 4)) : null;
      return { e, occurrence, daysAway, years };
    }).filter(Boolean).filter((x) => x.daysAway <= 30 && (intent !== 'ANNIVERSARY' || x.years > 0)).sort((a,b)=>a.daysAway-b.daysAway);
    if (!upcoming.length) return { answer: `No ${intent === 'BIRTHDAY' ? 'birthdays' : 'work anniversaries'} are coming up in the next 30 days within your scope.`, intent };
    const label = upcoming.slice(0, 8).map((x) => {
      const when = x.daysAway === 0 ? 'today' : x.daysAway === 1 ? 'tomorrow' : `in ${x.daysAway} days`;
      return intent === 'BIRTHDAY' ? `${fullName(x.e)} — ${when}` : `${fullName(x.e)} — ${x.years} year${x.years === 1 ? '' : 's'} — ${when}`;
    }).join('; ');
    return { answer: `${intent === 'BIRTHDAY' ? 'Upcoming birthdays' : 'Upcoming work anniversaries'}: ${label}.`, intent };
  }

  if (intent === 'COUNT') {
    const rows = await Attendance.find({
      tenantId, employeeId: { $in: allowedIds }, date: day
    }).select('status');
    const present = rows.filter((r) => ['PRESENT', 'WFH'].includes(r.status)).length;
    const half = rows.filter((r) => r.status === 'HALF_DAY').length;
    const leave = rows.filter((r) => r.status === 'LEAVE').length;
    const absent = Math.max(0, allowedIds.length - present - half - leave);
    return {
      answer: `On ${dateKey(day)}: ${present} present${half ? `, ${half} on half day` : ''}${leave ? `, ${leave} on leave` : ''}, ${absent} absent, out of ${allowedIds.length} people in your scope.`,
      intent, facts: { present, half, leave, absent, scope: allowedIds.length }
    };
  }

  // Questions the rule-based intents do not cover go to Gemini, grounded on
  // the caller's permission-filtered people and today's attendance.
  async function groundedAnswer() {
    if (!(await isAvailable(tenantId, 'ASSISTANT'))) return null;
    try {
      const people = await Employee.find({ tenantId, _id: { $in: allowedIds }, status: { $ne: 'OFFBOARDED' } }).select('employeeCode firstName lastName department designation workLocation').limit(400);
      const rows = await Attendance.find({ tenantId, employeeId: { $in: allowedIds }, date: day }).select('employeeId status checkIn checkOut lateMinutes earlyLeaveMinutes lopDays');
      const rowMap = new Map(rows.map((r) => [String(r.employeeId), r]));
      const context = people.map((e) => { const r = rowMap.get(String(e._id)); return { employeeCode: e.employeeCode, name: fullName(e), department: e.department, designation: e.designation, workLocation: e.workLocation, attendance: r ? { status: r.status, checkIn: r.checkIn, checkOut: r.checkOut, lateMinutes: r.lateMinutes, earlyLeaveMinutes: r.earlyLeaveMinutes, lopDays: r.lopDays } : null }; });
      const out = await generate({
        tenantId,
        userId: user?._id,
        feature: 'ASSISTANT',
        system: 'You are a read-only HR assistant inside an HRMS. Answer ONLY from the permission-filtered data you are given (people and their attendance for the day). Never invent facts. If the data cannot answer, say briefly what you can see instead, without the words "context" or "JSON". If the person asks you to change, add, remove, create, delete, approve, release, send, turn on or off, or set anything, reply exactly: "I can\'t do that from the chat for you. Please contact your administrator / HR." Answer in 1-4 short sentences. Times are in IST.',
        prompt: `Current HRMS date: ${dateKey(day)}. Question: ${question}\nContext (JSON): ${JSON.stringify(context)}`,
        maxOutputTokens: 2048,
        timeoutMs: 15000
      });
      return out.text ? { answer: out.text, intent: 'GEMINI_GROUNDED', gemini: true, model: out.model } : null;
    } catch (_) {
      return null;
    }
  }

  if (intent === 'UNKNOWN') {
    const grounded = await groundedAnswer();
    if (grounded) return grounded;
  }

  const person = await findPerson({ tenantId, question, allowedIds });

  if (person?.ambiguous) {
    return {
      answer: `More than one person matches. Did you mean ${person.ambiguous.map((c) => `${fullName(c)} (${c.employeeCode})`).join(', ')}?`,
      intent, needsClarification: true
    };
  }
  if (!person) {
    const grounded = await groundedAnswer();
    if (grounded) return grounded;
    return {
      answer: 'I could not find that person in the records you have access to. Try their full name or employee code.',
      intent, notFound: true
    };
  }

  const name = fullName(person);

  if (intent === 'SALARY') {
    if (!hasAbility(user, 'PAYROLL', 'READ') && !['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role)) {
      return { answer: `You do not have payroll access, so I cannot share ${name}'s salary details.`, intent, denied: true };
    }
    const slip = await SalarySlip.findOne({ tenantId, employeeId: person._id }).sort('-month').populate('payrollRunId', 'status');
    if (!slip) return { answer: `No payslip has been generated for ${name} yet.`, intent };
    if (slip.payrollRunId?.status !== 'FINALIZED') {
      return { answer: `${name}'s ${slip.month} payroll is still a draft, so the figures are not final yet.`, intent };
    }
    return {
      answer: `${name}'s ${slip.month} net pay was ₹${Number(slip.netPay || 0).toLocaleString('en-IN')}, with ${slip.attendanceStats?.payableDays ?? '—'} payable of ${slip.attendanceStats?.workingDays ?? '—'} days.`,
      intent, facts: { month: slip.month, netPay: slip.netPay }
    };
  }

  const record = await Attendance.findOne({ tenantId, employeeId: person._id, date: day });
  const holidayRows = await Holiday.find({ tenantId, date: { $gte: new Date(day.getTime() - 86400000), $lte: new Date(endOfDay(day).getTime() + 86400000) } });
  const holiday = holidayRows.find((h) => holidayDateKey(h) === dateKey(day));

  if (intent === 'LEAVE') {
    const leave = await LeaveRequest.findOne({
      tenantId, employeeId: person._id, status: 'APPROVED',
      fromDate: { $lte: endOfDay(day) }, toDate: { $gte: day }
    });
    if (leave) {
      return { answer: `${name} is on approved ${leave.requestType === 'WFH' ? 'work from home' : `${leave.leaveType} leave`} on ${dateKey(day)}.`, intent };
    }
    return { answer: `${name} has no approved leave on ${dateKey(day)}.`, intent };
  }

  if (intent === 'IN_TIME' || intent === 'OUT_TIME') {
    if (!record?.checkIn) {
      return { answer: `No check-in is recorded for ${name} on ${dateKey(day)}${holiday ? ` (${holiday.name}, a holiday)` : ''}.`, intent };
    }
    if (intent === 'IN_TIME') {
      const late = Number(record.lateMinutes || 0);
      return {
        answer: `${name} checked in at ${timeOf(record.checkIn)} on ${dateKey(day)}${late > 0 ? ` — ${late} minute${late === 1 ? '' : 's'} late` : ' — on time'}.`,
        intent, facts: { checkIn: record.checkIn, lateMinutes: late }
      };
    }
    if (!record.checkOut) {
      return {
        answer: record.missingCheckOut
          ? `${name} never checked out on ${dateKey(day)} and the day was closed automatically. It needs a regularization.`
          : `${name} is still checked in — no check-out yet.`,
        intent
      };
    }
    return { answer: `${name} checked out at ${timeOf(record.checkOut)} on ${dateKey(day)}.`, intent };
  }

  // PRESENCE / UNKNOWN both answer with the day's picture, which is what
  // "is X present today?" actually wants.
  if (holiday && !record?.checkIn) {
    return { answer: `${dateKey(day)} is ${holiday.name}, a holiday. ${name} has no punch recorded.`, intent };
  }
  if (!record) {
    return { answer: `${name} has no attendance recorded on ${dateKey(day)} — currently counted absent (1 day LOP) unless leave is applied and approved.`, intent };
  }

  const bits = [`${name} is marked ${String(record.status || 'UNKNOWN').replace('_', ' ').toLowerCase()} on ${dateKey(day)}`];
  if (record.checkIn) bits.push(`in at ${timeOf(record.checkIn)}`);
  if (record.checkOut) bits.push(`out at ${timeOf(record.checkOut)}`);
  else if (record.checkIn) bits.push('no check-out yet');
  if (Number(record.lateMinutes || 0) > 0) bits.push(`${record.lateMinutes}m late`);
  if (Number(record.lopDays || 0) > 0) bits.push(`${record.lopDays} LOP`);

  return {
    answer: `${bits.join(' · ')}.`,
    intent,
    facts: { status: record.status, checkIn: record.checkIn, checkOut: record.checkOut, lopDays: record.lopDays }
  };
}

module.exports = { answerHrQuestion, classify, findPerson };
