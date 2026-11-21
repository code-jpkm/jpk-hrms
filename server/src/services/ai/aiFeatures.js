/**
 * Gemini-powered HR features. Every feature follows the same rules:
 *
 *  1. Facts come from the database, filtered by the caller's scope. Gemini
 *     only writes prose around numbers we computed — it is told never to
 *     invent people, dates or amounts, and flags in reviews are computed in
 *     code, not by the model.
 *  2. Where a feature is useful without AI (briefing, leave insight, payroll
 *     review), a deterministic fallback is returned with usedAi:false, so the
 *     screen still works when no Gemini key is configured.
 *  3. Output is structured JSON with a schema, so the UI renders it safely.
 */
const Employee = require('../../models/Employee');
const Attendance = require('../../models/Attendance');
const LeaveRequest = require('../../models/LeaveRequest');
const LeaveBalance = require('../../models/LeaveBalance');
const Regularization = require('../../models/Regularization');
const Holiday = require('../../models/Holiday');
const PayrollRun = require('../../models/PayrollRun');
const SalarySlip = require('../../models/SalarySlip');
const JobOpening = require('../../models/JobOpening');
const Candidate = require('../../models/Candidate');
const Tenant = require('../../models/Tenant');
const { generate, AiUnavailableError } = require('./geminiClient');
const { getScopedEmployeeIds } = require('../scopeService');
const { semanticDateKey, holidayDateKey, formatIndianDate } = require('../../utils/date');

const IST_OFFSET_MS = 330 * 60 * 1000;

function istTodayKey(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Both storage conventions for a calendar day (UTC midnight and IST midnight). */
function dayWindow(key) {
  const utc = new Date(`${key}T00:00:00.000Z`);
  return { $gte: new Date(utc.getTime() - IST_OFFSET_MS), $lte: new Date(utc.getTime() + 86399999) };
}

function fullName(e) {
  return `${e?.firstName || ''} ${e?.lastName || ''}`.trim();
}

function inr(n) {
  const v = Math.round(Number(n || 0));
  return `₹${v.toLocaleString('en-IN')}`;
}

async function company(tenantId) {
  const t = await Tenant.findById(tenantId).select('name').lean();
  return t?.name || 'the company';
}

const BASE_RULES = 'You write for an Indian manufacturing company\'s HR system. Use clear, warm, professional Indian English. Use only the facts provided. Never invent names, dates, numbers or policies. If information is missing, say so briefly. No markdown headings.';

async function tryAi(args) {
  try {
    return await generate(args);
  } catch (error) {
    if (error instanceof AiUnavailableError) return { ok: false, reason: error.reason, message: error.message };
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Daily briefing                                                       */
/* ------------------------------------------------------------------ */
async function dailyBriefing({ tenantId, user, employee }) {
  const todayKey = istTodayKey();
  const isAdmin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role);
  const [attendanceScope, leaveScope] = await Promise.all([
    getScopedEmployeeIds({ user, employee, resource: 'ATTENDANCE' }),
    getScopedEmployeeIds({ user, employee, resource: 'LEAVE' })
  ]);
  const teamView = attendanceScope.length > 1;
  const facts = { date: todayKey, role: user.role, firstName: String(user.name || employee?.firstName || '').split(' ')[0] };

  const [todayRows, pendingLeaves, pendingRegs, holidays, onLeaveToday] = await Promise.all([
    Attendance.find({ tenantId, employeeId: { $in: attendanceScope }, date: dayWindow(todayKey) }).select('employeeId status lateMinutes checkIn').lean(),
    LeaveRequest.countDocuments({ tenantId, employeeId: { $in: leaveScope }, status: 'PENDING' }),
    Regularization.countDocuments({ tenantId, employeeId: { $in: attendanceScope }, status: 'PENDING' }),
    Holiday.find({ tenantId, date: { $gte: new Date(Date.now() - 2 * 86400000) } }).sort('date').limit(8).lean(),
    LeaveRequest.find({ tenantId, employeeId: { $in: leaveScope }, status: 'APPROVED', fromDate: { $lte: dayWindow(todayKey).$lte }, toDate: { $gte: dayWindow(todayKey).$gte } }).populate('employeeId', 'firstName lastName').lean()
  ]);

  const present = todayRows.filter((r) => ['PRESENT', 'WFH', 'HALF_DAY'].includes(r.status) && r.checkIn).length;
  const late = todayRows.filter((r) => Number(r.lateMinutes) > 0).length;
  const nextHoliday = holidays.map((h) => ({ name: h.name, date: holidayDateKey(h) })).filter((h) => h.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date))[0];

  if (teamView) {
    Object.assign(facts, {
      peopleInScope: attendanceScope.length,
      checkedInSoFar: present,
      lateToday: late,
      onApprovedLeaveToday: onLeaveToday.map((l) => fullName(l.employeeId)).filter(Boolean),
      pendingLeaveApprovals: pendingLeaves,
      pendingAttendanceCorrections: pendingRegs
    });
  }
  if (employee) {
    const mine = todayRows.find((r) => String(r.employeeId) === String(employee._id));
    const balances = await LeaveBalance.find({ tenantId, employeeId: employee._id }).lean();
    Object.assign(facts, {
      myCheckIn: mine?.checkIn ? new Date(mine.checkIn).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null,
      myLeaveBalance: balances.map((b) => ({ type: b.leaveType, available: Number(b.accrued || 0) + Number(b.manualAdjusted || 0) + Number(b.carriedForward || 0) - Number(b.used || 0) }))
    });
  }
  if (nextHoliday) facts.nextHoliday = nextHoliday;
  if (isAdmin) {
    const month = todayKey.slice(0, 7);
    const run = await PayrollRun.findOne({ tenantId, month }).select('status').lean();
    facts.payrollThisMonth = run ? run.status : 'not generated yet';
    facts.dayOfMonth = Number(todayKey.slice(8, 10));
  }

  const fallbackBullets = [];
  if (teamView) {
    fallbackBullets.push(`${present} of ${attendanceScope.length} people have checked in${late ? `, ${late} late` : ''}.`);
    if (onLeaveToday.length) fallbackBullets.push(`${onLeaveToday.length} on approved leave today.`);
    if (pendingLeaves || pendingRegs) fallbackBullets.push(`${pendingLeaves} leave and ${pendingRegs} attendance request${pendingLeaves + pendingRegs === 1 ? '' : 's'} waiting for you.`);
  }
  if (employee && !teamView) fallbackBullets.push(facts.myCheckIn ? `You checked in at ${facts.myCheckIn}.` : 'You have not checked in yet today.');
  if (nextHoliday) fallbackBullets.push(`Next holiday: ${nextHoliday.name} on ${formatIndianDate(new Date(`${nextHoliday.date}T00:00:00.000Z`), { weekday: 'short', day: 'numeric', month: 'short' })}.`);
  if (isAdmin && facts.dayOfMonth >= 20 && facts.payrollThisMonth === 'not generated yet') fallbackBullets.push('Payroll for this month has not been generated yet.');

  const ai = await tryAi({
    tenantId,
    userId: user._id,
    feature: 'BRIEFING',
    system: `${BASE_RULES} You write a short morning briefing for the HRMS home page.`,
    prompt: `Write today's briefing for ${facts.firstName || 'the user'} from these facts (JSON): ${JSON.stringify(facts)}.\nReturn JSON: headline (max 12 words, friendly), bullets (2-4 items, each under 20 words, most important first), focus (one concrete suggested action under 16 words, or empty).`,
    json: true,
    schema: { type: 'object', properties: { headline: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, focus: { type: 'string' } }, required: ['headline', 'bullets'] },
    maxOutputTokens: 2048
  });
  if (ai.ok && ai.data) {
    return { usedAi: true, model: ai.model, headline: String(ai.data.headline || '').slice(0, 120), bullets: (ai.data.bullets || []).map(String).slice(0, 4), focus: String(ai.data.focus || '').slice(0, 160), facts };
  }
  return { usedAi: false, reason: ai.message, headline: teamView ? 'Here is your team today' : 'Here is your day', bullets: fallbackBullets.slice(0, 4), focus: pendingLeaves ? 'Clear pending leave approvals before noon.' : '', facts };
}

/* ------------------------------------------------------------------ */
/* Recruitment                                                          */
/* ------------------------------------------------------------------ */
async function jobDescription({ tenantId, userId, input }) {
  const name = await company(tenantId);
  const facts = {
    company: name,
    title: String(input.title || '').slice(0, 120),
    department: input.department,
    location: input.location,
    experience: input.experience,
    employmentType: input.employmentType,
    skills: input.skills,
    ctc: input.ctc,
    notes: String(input.notes || '').slice(0, 800)
  };
  if (!facts.title) throw Object.assign(new Error('Job title is required'), { status: 400 });
  const ai = await tryAi({
    tenantId, userId, feature: 'RECRUITMENT',
    system: `${BASE_RULES} You are an experienced HR business partner writing job descriptions for a metals manufacturing company in India.`,
    prompt: `Write a job description from these details (JSON): ${JSON.stringify(facts)}. Keep it specific to the role and the plant/office setting. Return JSON with summary (2-3 sentences), responsibilities (5-8 items), requirements (4-7 items), niceToHave (0-4 items), benefits (0-5 items; only generic, non-numeric benefits unless ctc is given).`,
    json: true,
    schema: { type: 'object', properties: { summary: { type: 'string' }, responsibilities: { type: 'array', items: { type: 'string' } }, requirements: { type: 'array', items: { type: 'string' } }, niceToHave: { type: 'array', items: { type: 'string' } }, benefits: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'responsibilities', 'requirements'] }
  });
  if (!ai.ok) throw Object.assign(new Error(ai.message), { status: 503 });
  const d = ai.data;
  const text = [
    d.summary, '',
    'Responsibilities', ...(d.responsibilities || []).map((x) => `• ${x}`), '',
    'Requirements', ...(d.requirements || []).map((x) => `• ${x}`),
    ...(d.niceToHave?.length ? ['', 'Good to have', ...d.niceToHave.map((x) => `• ${x}`)] : []),
    ...(d.benefits?.length ? ['', 'What we offer', ...d.benefits.map((x) => `• ${x}`)] : [])
  ].join('\n');
  return { usedAi: true, model: ai.model, data: d, text };
}

async function screenCandidate({ tenantId, userId, candidateId, resumeText = '' }) {
  const candidate = await Candidate.findOne({ _id: candidateId, tenantId }).lean();
  if (!candidate) throw Object.assign(new Error('Candidate not found'), { status: 404 });
  const opening = candidate.jobOpeningId ? await JobOpening.findOne({ _id: candidate.jobOpeningId, tenantId }).lean() : null;
  const profile = {
    position: candidate.position || opening?.title,
    qualification: candidate.qualification,
    experienceYears: candidate.experience,
    currentCompany: candidate.currentCompany,
    expectedCtc: candidate.expectedCtc,
    notes: String(candidate.notes || '').slice(0, 1500),
    resumeText: String(resumeText || '').slice(0, 12000)
  };
  const role = opening ? { title: opening.title, experience: opening.experience, description: String(opening.description || '').slice(0, 3000), location: opening.location } : { title: candidate.position };
  const ai = await tryAi({
    tenantId, userId, feature: 'RECRUITMENT',
    system: `${BASE_RULES} You screen candidates fairly. Ignore and never mention age, gender, religion, caste, marital status, photos or other protected attributes.`,
    prompt: `Assess how well this candidate fits the role. Role (JSON): ${JSON.stringify(role)}. Candidate (JSON): ${JSON.stringify(profile)}.\nReturn JSON: score (0-100 integer), verdict ("Strong fit", "Possible fit" or "Weak fit"), summary (2 sentences), strengths (2-5), gaps (1-5, things to verify), questions (3-5 interview questions that probe the gaps).`,
    json: true,
    schema: { type: 'object', properties: { score: { type: 'integer' }, verdict: { type: 'string' }, summary: { type: 'string' }, strengths: { type: 'array', items: { type: 'string' } }, gaps: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } } }, required: ['score', 'verdict', 'summary'] }
  });
  if (!ai.ok) throw Object.assign(new Error(ai.message), { status: 503 });
  const d = ai.data;
  d.score = Math.max(0, Math.min(100, Math.round(Number(d.score) || 0)));
  return { usedAi: true, model: ai.model, data: d, candidate: { _id: candidate._id, name: candidate.name, position: profile.position } };
}

async function interviewQuestions({ tenantId, userId, input }) {
  const facts = { title: String(input.title || '').slice(0, 120), skills: input.skills, level: input.level || 'mid-level', round: input.round || 'technical', count: Math.max(3, Math.min(12, Number(input.count) || 6)) };
  if (!facts.title) throw Object.assign(new Error('Role title is required'), { status: 400 });
  const ai = await tryAi({
    tenantId, userId, feature: 'RECRUITMENT',
    system: `${BASE_RULES} You are a hiring manager at a metals manufacturing company.`,
    prompt: `Create ${facts.count} interview questions for (JSON): ${JSON.stringify(facts)}. Mix practical, situational and safety/quality questions where relevant. Return JSON: questions (array of {question, lookFor}).`,
    json: true,
    schema: { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, lookFor: { type: 'string' } }, required: ['question'] } } }, required: ['questions'] }
  });
  if (!ai.ok) throw Object.assign(new Error(ai.message), { status: 503 });
  return { usedAi: true, model: ai.model, data: { questions: (ai.data.questions || []).slice(0, facts.count) } };
}

/* ------------------------------------------------------------------ */
/* Notices, translation, polishing, messages, documents                 */
/* ------------------------------------------------------------------ */
async function noticeDraft({ tenantId, userId, input }) {
  const brief = String(input.brief || '').trim().slice(0, 2000);
  if (!brief) throw Object.assign(new Error('Describe what the notice should say'), { status: 400 });
  const name = await company(tenantId);
  const ai = await tryAi({
    tenantId, userId, feature: 'NOTICES',
    system: `${BASE_RULES} You draft internal notices for ${name}. Notices are read on phones by office staff and plant workers, so keep sentences short.`,
    prompt: `Draft a notice. Brief: ${brief}\nAudience: ${input.audience || 'all employees'}. Tone: ${input.tone || 'professional and friendly'}.\nReturn JSON: title (max 10 words), body (60-160 words, plain text paragraphs; include date/time/place only if given in the brief).`,
    json: true,
    schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] }
  });
  if (!ai.ok) throw Object.assign(new Error(ai.message), { status: 503 });
  return { usedAi: true, model: ai.model, data: { title: String(ai.data.title || '').slice(0, 140), body: String(ai.data.body || '') } };
}

const LANGUAGES = { hi: 'Hindi (Devanagari script)', bn: 'Bengali (Bangla script)', en: 'English', or: 'Odia', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', gu: 'Gujarati' };
async function translate({ tenantId, userId, text, target }) {
  const lang = LANGUAGES[target];
  if (!lang) throw Object.assign(new Error('Choose a supported language'), { status: 400 });
  const source = String(text || '').slice(0, 6000);
  if (!source.trim()) throw Object.assign(new Error('Nothing to translate'), { status: 400 });
  const ai = await tryAi({
    tenantId, userId, feature: 'NOTICES',
    system: 'You translate HR communication faithfully. Keep names, dates, numbers and employee codes unchanged. Return only the translation.',
    prompt: `Translate into ${lang}:\n\n${source}`,
    maxOutputTokens: 4096
  });
  if (!ai.ok) throw Object.assign(new Error(ai.message), { status: 503 });
  return { usedAi: true, model: ai.model, text: ai.text };
}

const POLISH_PURPOSES = {
  LEAVE_REASON: 'a leave application reason, one or two polite sentences',
  REGULARIZATION_REASON: 'an attendance correction reason, one or two factual sentences',
  DECISION_REMARKS: 'remarks from a manager on an approval decision, one or two respectful sentences',
  NOTICE: 'an internal notice body',
  GENERAL: 'a short professional HR message'
};
async function polish({ tenantId, userId, text, purpose = 'GENERAL' }) {
  const source = String(text || '').trim().slice(0, 2000);
  if (!source) throw Object.assign(new Error('Write something first'), { status: 400 });
  const ai = await tryAi({
    tenantId, userId, feature: 'MESSAGES',
    system: `${BASE_RULES} Rewrite text so it is clear and professional without adding facts.`,
    prompt: `Rewrite this as ${POLISH_PURPOSES[purpose] || POLISH_PURPOSES.GENERAL}. Keep the meaning and every fact. Text: ${source}\nReturn only the rewritten text.`,
    maxOutputTokens: 1024
  });
  if (!ai.ok) throw Object.assign(new Error(ai.message), { status: 503 });
  return { usedAi: true, model: ai.model, text: ai.text.replace(/^"|"$/g, '') };
}

async function composeMessage({ tenantId, userId, purpose, employeeId, tone, channel, extra, fromName }) {
  const emp = employeeId ? await Employee.findOne({ _id: employeeId, tenantId }).select('firstName lastName department designation dateOfJoining').lean() : null;
  const name = await company(tenantId);
  const years = emp?.dateOfJoining ? Math.max(0, Number(istTodayKey().slice(0, 4)) - Number(semanticDateKey(emp.dateOfJoining).slice(0, 4))) : undefined;
  const facts = { purpose, company: name, firstName: emp?.firstName, department: emp?.department, designation: emp?.designation, yearsWithCompany: purpose === 'ANNIVERSARY' ? years : undefined, from: fromName, extra: String(extra || '').slice(0, 600) };
  const short = channel === 'WHATSAPP';
  const fallback = purpose === 'BIRTHDAY'
    ? `Wishing you a very happy birthday, ${emp?.firstName || ''}! May the year ahead bring you good health, happiness and success.`.replace(' ,', ',')
    : purpose === 'ANNIVERSARY'
      ? `Congratulations on completing ${years || 'another'} year${years === 1 ? '' : 's'} with ${name}! Thank you for your hard work and commitment.`
      : purpose === 'WELCOME'
        ? `Welcome to ${name}, ${emp?.firstName || ''}! We are glad to have you with us.`
        : String(extra || '');
  const ai = await tryAi({
    tenantId, userId, feature: 'MESSAGES',
    system: `${BASE_RULES} You write warm, personal workplace messages. No emojis unless the purpose is a celebration (then at most one).`,
    prompt: `Write a ${purpose.toLowerCase()} message (${short ? 'max 45 words, suitable for WhatsApp' : '40-90 words, suitable for email'}) in a ${tone || 'warm'} tone using these facts (JSON): ${JSON.stringify(facts)}. Do not start with "Dear". Return only the message.`,
    maxOutputTokens: 1024
  });
  if (ai.ok) return { usedAi: true, model: ai.model, text: ai.text.replace(/^"|"$/g, '') };
  return { usedAi: false, reason: ai.message, text: fallback };
}

async function draftDocument({ tenantId, userId, input }) {
  const name = await company(tenantId);
  const kind = String(input.kind || 'letter').slice(0, 60);
  const prompt = String(input.prompt || '').slice(0, 2000);
  if (!prompt) throw Object.assign(new Error('Describe the letter you need'), { status: 400 });
  const ai = await tryAi({
    tenantId, userId, feature: 'DOCUMENTS',
    system: `${BASE_RULES} You draft formal HR letters for ${name} in India. Use placeholders exactly in double curly braces for employee-specific values, chosen from: {{employee.fullName}}, {{employee.employeeCode}}, {{employee.designation}}, {{employee.department}}, {{employee.dateOfJoining}}, {{today}}, {{company.name}}. Do not invent salary figures; use placeholders like [amount] if needed.`,
    prompt: `Draft a ${kind}. Requirements: ${prompt}\nReturn JSON: title, paragraphs (3-8 plain-text paragraphs, no greeting line duplication), closing (e.g. "Yours sincerely,"), signatory (e.g. "HR Department").`,
    json: true,
    schema: { type: 'object', properties: { title: { type: 'string' }, paragraphs: { type: 'array', items: { type: 'string' } }, closing: { type: 'string' }, signatory: { type: 'string' } }, required: ['title', 'paragraphs'] }
  });
  if (!ai.ok) throw Object.assign(new Error(ai.message), { status: 503 });
  return { usedAi: true, model: ai.model, data: ai.data, text: [ai.data.title, '', ...(ai.data.paragraphs || []), '', ai.data.closing || 'Yours sincerely,', ai.data.signatory || 'HR Department'].join('\n\n') };
}

/* ------------------------------------------------------------------ */
/* Leave approval insight                                               */
/* ------------------------------------------------------------------ */
async function leaveInsight({ tenantId, user, employee, requestId }) {
  const request = await LeaveRequest.findOne({ _id: requestId, tenantId }).populate('employeeId', 'firstName lastName employeeCode department workLocation reportsTo').lean();
  if (!request) throw Object.assign(new Error('Leave request not found'), { status: 404 });
  const scope = new Set((await getScopedEmployeeIds({ user, employee, resource: 'LEAVE' })).map(String));
  if (!scope.has(String(request.employeeId?._id))) throw Object.assign(new Error('This request is outside your scope'), { status: 403 });
  const emp = request.employeeId;
  const fromKey = semanticDateKey(request.fromDate);
  const toKey = semanticDateKey(request.toDate || request.fromDate);

  const [balance, overlaps, history, holidays] = await Promise.all([
    request.requestType === 'LEAVE' ? LeaveBalance.findOne({ tenantId, employeeId: emp._id, leaveType: request.leaveType }).lean() : null,
    LeaveRequest.find({
      tenantId,
      _id: { $ne: request._id },
      status: { $in: ['APPROVED', 'PENDING'] },
      fromDate: { $lte: dayWindow(toKey).$lte },
      toDate: { $gte: dayWindow(fromKey).$gte }
    }).populate('employeeId', 'firstName lastName department').lean(),
    LeaveRequest.find({ tenantId, employeeId: emp._id, status: 'APPROVED', fromDate: { $gte: new Date(Date.now() - 183 * 86400000) } }).select('fromDate toDate days leaveType').lean(),
    Holiday.find({ tenantId, date: { $gte: new Date(new Date(`${fromKey}T00:00:00Z`).getTime() - 4 * 86400000), $lte: new Date(new Date(`${toKey}T00:00:00Z`).getTime() + 4 * 86400000) } }).lean()
  ]);

  const sameDept = overlaps.filter((o) => o.employeeId && o.employeeId.department && o.employeeId.department === emp.department);
  const available = balance ? Number(balance.accrued || 0) + Number(balance.manualAdjusted || 0) + Number(balance.carriedForward || 0) - Number(balance.used || 0) : null;
  const daysTaken6m = history.reduce((s, h) => s + Number(h.days || 0), 0);
  const adjacentDays = (key) => {
    const d = new Date(`${key}T00:00:00Z`).getUTCDay();
    return d;
  };
  const flags = [];
  if (available !== null && available < Number(request.days || 0)) flags.push({ severity: 'high', text: `Balance is ${available} ${request.leaveType} day(s) but ${request.days} requested; the excess would be loss of pay.` });
  if (sameDept.length) flags.push({ severity: sameDept.length >= 2 ? 'high' : 'medium', text: `${sameDept.length} other ${emp.department} colleague${sameDept.length === 1 ? ' is' : 's are'} off on overlapping dates: ${sameDept.map((o) => fullName(o.employeeId)).slice(0, 4).join(', ')}.` });
  const startDow = adjacentDays(fromKey);
  const endDow = adjacentDays(toKey);
  const nearHoliday = holidays.map((h) => ({ name: h.name, key: holidayDateKey(h) })).filter((h) => h.key < fromKey || h.key > toKey);
  if (nearHoliday.length) flags.push({ severity: 'low', text: `Dates sit next to ${nearHoliday.map((h) => h.name).join(', ')}; check your sandwich-leave rule.` });
  if ((startDow === 1 || endDow === 5) && history.filter((h) => [1, 5].includes(new Date(`${semanticDateKey(h.fromDate)}T00:00:00Z`).getUTCDay())).length >= 2) flags.push({ severity: 'low', text: 'Several recent leaves also start on a Monday or end on a Friday.' });

  const facts = {
    employee: fullName(emp), department: emp.department, request: { type: request.requestType === 'WFH' ? 'WFH' : request.leaveType, from: fromKey, to: toKey, days: request.days, reason: request.reason || '' },
    balanceBefore: available, balanceAfter: available !== null ? available - Number(request.days || 0) : null,
    approvedLeaveDaysLast6Months: daysTaken6m,
    overlappingColleaguesSameDepartment: sameDept.map((o) => fullName(o.employeeId)),
    overlappingTotal: overlaps.length,
    flags: flags.map((f) => f.text)
  };
  const recommendation = flags.some((f) => f.severity === 'high') ? 'Review' : 'Approve';
  const fallbackSummary = `${facts.employee} asks for ${request.days} day(s) from ${fromKey} to ${toKey}.${available !== null ? ` Balance after approval: ${facts.balanceAfter}.` : ''} ${sameDept.length ? `${sameDept.length} same-department overlap(s).` : 'No same-department overlap.'}`;

  const ai = await tryAi({
    tenantId, userId: user._id, feature: 'LEAVE',
    system: `${BASE_RULES} You help a manager decide on a leave request. Be neutral and brief; the manager decides.`,
    prompt: `Summarise this leave request for the approver in 2-3 sentences, mentioning balance and team coverage. Facts (JSON): ${JSON.stringify(facts)}. Return JSON: summary.`,
    json: true,
    schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    maxOutputTokens: 1536
  });
  return {
    usedAi: Boolean(ai.ok),
    model: ai.model,
    reason: ai.ok ? undefined : ai.message,
    data: { summary: ai.ok ? ai.data.summary : fallbackSummary, recommendation, flags, balanceBefore: available, balanceAfter: facts.balanceAfter, overlaps: overlaps.slice(0, 8).map((o) => ({ name: fullName(o.employeeId), department: o.employeeId?.department, from: semanticDateKey(o.fromDate), to: semanticDateKey(o.toDate), status: o.status })) }
  };
}

/* ------------------------------------------------------------------ */
/* Payroll                                                              */
/* ------------------------------------------------------------------ */
function sumObj(o) {
  return Object.values(o || {}).reduce((s, v) => s + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
}

async function payrollReview({ tenantId, user, month }) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw Object.assign(new Error('Month must look like 2026-11'), { status: 400 });
  const [y, m] = month.split('-').map(Number);
  const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const [slips, prevSlips, activeCount] = await Promise.all([
    SalarySlip.find({ tenantId, month }).populate('employeeId', 'firstName lastName employeeCode status department').lean(),
    SalarySlip.find({ tenantId, month: prevMonth }).select('employeeId netPay').lean(),
    Employee.countDocuments({ tenantId, status: { $nin: ['OFFBOARDED'] } })
  ]);
  if (!slips.length) throw Object.assign(new Error(`No salary slips found for ${month}. Generate payroll first.`), { status: 404 });
  const prev = new Map(prevSlips.map((s) => [String(s.employeeId), Number(s.netPay || 0)]));
  const flags = [];
  let totalNet = 0;
  let totalGross = 0;
  for (const s of slips) {
    const name = `${fullName(s.employeeId)} (${s.employeeId?.employeeCode || ''})`;
    const net = Number(s.netPay || 0);
    const gross = sumObj(s.earnings);
    totalNet += net;
    totalGross += gross;
    if (net <= 0) flags.push({ severity: 'high', employee: name, issue: `Net pay is ${inr(net)}.` });
    const before = prev.get(String(s.employeeId?._id));
    if (before && before > 0) {
      const change = (net - before) / before;
      if (Math.abs(change) >= 0.2) flags.push({ severity: Math.abs(change) >= 0.4 ? 'high' : 'medium', employee: name, issue: `Net pay ${change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(change) * 100)}% vs ${prevMonth} (${inr(before)} → ${inr(net)}).` });
    }
    const lop = Number(s.attendanceStats?.lopDays || s.attendanceStats?.lop || 0);
    if (lop >= 5) flags.push({ severity: 'medium', employee: name, issue: `${lop} LOP day(s) this month.` });
    const esi = Number(s.deductions?.esi || 0);
    if (esi > 0 && gross > 21000) flags.push({ severity: 'medium', employee: name, issue: `ESI deducted although gross is ${inr(gross)} (above the ₹21,000 ceiling).` });
    if (s.employeeId?.status === 'OFFBOARDED') flags.push({ severity: 'high', employee: name, issue: 'Slip generated for an offboarded employee.' });
  }
  if (slips.length < activeCount) flags.push({ severity: 'medium', employee: 'Payroll run', issue: `${activeCount - slips.length} active employee(s) have no slip for ${month}.` });
  const prevTotal = prevSlips.reduce((s, x) => s + Number(x.netPay || 0), 0);
  const facts = { month, slips: slips.length, activeEmployees: activeCount, totalGross: inr(totalGross), totalNet: inr(totalNet), previousMonthTotalNet: prevTotal ? inr(prevTotal) : null, flagCount: flags.length, topFlags: flags.slice(0, 12).map((f) => `${f.employee}: ${f.issue}`) };
  const ai = await tryAi({
    tenantId, userId: user._id, feature: 'PAYROLL',
    system: `${BASE_RULES} You review payroll for an HR/finance lead before release.`,
    prompt: `Summarise this payroll check in 3-4 sentences: overall totals vs last month, the most important exceptions to verify, and whether it looks ready to release. Facts (JSON): ${JSON.stringify(facts)}. Return JSON: summary, readiness ("Looks ready", "Check exceptions first" or "Not ready").`,
    json: true,
    schema: { type: 'object', properties: { summary: { type: 'string' }, readiness: { type: 'string' } }, required: ['summary'] },
    maxOutputTokens: 2048
  });
  const readiness = flags.some((f) => f.severity === 'high') ? 'Check exceptions first' : 'Looks ready';
  return {
    usedAi: Boolean(ai.ok), model: ai.model, reason: ai.ok ? undefined : ai.message,
    data: {
      summary: ai.ok ? ai.data.summary : `${slips.length} slips, total net ${inr(totalNet)}${prevTotal ? ` (last month ${inr(prevTotal)})` : ''}. ${flags.length} item(s) to check.`,
      readiness: ai.ok && ai.data.readiness ? ai.data.readiness : readiness,
      totals: { slips: slips.length, gross: totalGross, net: totalNet, previousNet: prevTotal },
      flags
    }
  };
}

async function explainPayslip({ tenantId, user, employee, slipId }) {
  const slip = await SalarySlip.findOne({ _id: slipId, tenantId }).populate('employeeId', 'firstName lastName userId').lean();
  if (!slip) throw Object.assign(new Error('Payslip not found'), { status: 404 });
  const own = employee && String(slip.employeeId?._id) === String(employee._id);
  const privileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role);
  if (!own && !privileged) throw Object.assign(new Error('You can only explain your own payslip'), { status: 403 });
  const facts = { month: slip.month, earnings: slip.earnings, deductions: slip.deductions, adjustments: slip.manualAdjustments, attendance: slip.attendanceStats, netPay: slip.netPay };
  const ai = await tryAi({
    tenantId, userId: user._id, feature: 'PAYROLL',
    system: `${BASE_RULES} You explain an Indian payslip to an employee in simple language. PF is Provident Fund (retirement savings), ESI is Employees' State Insurance (medical cover), PT is Professional Tax (state tax), LOP is loss of pay for unpaid days.`,
    prompt: `Explain this payslip to ${slip.employeeId?.firstName || 'the employee'} in 4-7 short bullet points: what they earned, each deduction and why, any LOP impact, and the net pay. Amounts in rupees. Facts (JSON): ${JSON.stringify(facts)}. Return JSON: bullets (array of strings).`,
    json: true,
    schema: { type: 'object', properties: { bullets: { type: 'array', items: { type: 'string' } } }, required: ['bullets'] },
    maxOutputTokens: 2048
  });
  if (!ai.ok) throw Object.assign(new Error(ai.message), { status: 503 });
  return { usedAi: true, model: ai.model, data: { bullets: (ai.data.bullets || []).slice(0, 8) } };
}

/* ------------------------------------------------------------------ */
/* Attendance insights                                                  */
/* ------------------------------------------------------------------ */
async function attendanceInsights({ tenantId, user, employee, month, employeeId }) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw Object.assign(new Error('Month must look like 2026-11'), { status: 400 });
  let scope = await getScopedEmployeeIds({ user, employee, resource: 'ATTENDANCE' });
  // Optional: insights for one person (the calendar being viewed), still inside
  // the caller's scope, built from the same day-by-day calendar the person sees.
  if (employeeId) {
    if (!scope.map(String).includes(String(employeeId))) throw Object.assign(new Error('This employee is outside your attendance scope'), { status: 403 });
    return personalAttendanceInsights({ tenantId, user, employeeId, month });
  }
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
  const to = new Date(Date.UTC(y, m, 1) - 1);
  const [rows, people] = await Promise.all([
    Attendance.find({ tenantId, employeeId: { $in: scope }, date: { $gte: from, $lte: to } }).select('employeeId date status lateMinutes earlyLeaveMinutes lopDays missingCheckOut').lean(),
    Employee.find({ tenantId, _id: { $in: scope }, status: { $ne: 'OFFBOARDED' } }).select('firstName lastName employeeCode department workLocation').lean()
  ]);
  const byId = new Map(people.map((p) => [String(p._id), p]));
  const per = new Map();
  const dow = [0, 0, 0, 0, 0, 0, 0];
  const dept = new Map();
  let late = 0; let absent = 0; let present = 0; let missingOut = 0; let lop = 0;
  for (const r of rows) {
    const p = byId.get(String(r.employeeId));
    if (!p) continue;
    const s = per.get(String(r.employeeId)) || { name: fullName(p), code: p.employeeCode, department: p.department, late: 0, lateMinutes: 0, absent: 0, lop: 0 };
    if (Number(r.lateMinutes) > 0) { s.late += 1; s.lateMinutes += Number(r.lateMinutes); late += 1; }
    if (r.status === 'ABSENT') { s.absent += 1; absent += 1; const d = new Date(new Date(r.date).getTime() + IST_OFFSET_MS).getUTCDay(); dow[d] += 1; const k = p.department || 'Unassigned'; dept.set(k, (dept.get(k) || 0) + 1); }
    if (['PRESENT', 'WFH', 'HALF_DAY'].includes(r.status)) present += 1;
    if (r.missingCheckOut) missingOut += 1;
    s.lop += Number(r.lopDays || 0); lop += Number(r.lopDays || 0);
    per.set(String(r.employeeId), s);
  }
  const list = [...per.values()];
  const topLate = list.filter((x) => x.late).sort((a, b) => b.late - a.late || b.lateMinutes - a.lateMinutes).slice(0, 5).map((x) => ({ name: x.name, code: x.code, lateDays: x.late, avgLateMinutes: Math.round(x.lateMinutes / x.late) }));
  const topAbsent = list.filter((x) => x.absent).sort((a, b) => b.absent - a.absent).slice(0, 5).map((x) => ({ name: x.name, code: x.code, absentDays: x.absent }));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const facts = {
    month, people: people.length, presentDays: present, lateArrivals: late, absentDays: absent, lopDays: Math.round(lop * 10) / 10, missingCheckOuts: missingOut,
    absenceByWeekday: Object.fromEntries(days.map((d, i) => [d, dow[i]])),
    absenceByDepartment: Object.fromEntries([...dept.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
    mostLate: topLate, mostAbsent: topAbsent
  };
  const ai = await tryAi({
    tenantId, userId: user._id, feature: 'ATTENDANCE',
    system: `${BASE_RULES} You are an HR analyst summarising monthly attendance for managers.`,
    prompt: `Analyse this month's attendance. Facts (JSON): ${JSON.stringify(facts)}.\nReturn JSON: summary (2-3 sentences), highlights (2-4 positive or neutral observations), risks (1-4 patterns worth attention, naming people only from mostLate/mostAbsent), suggestions (1-3 practical actions).`,
    json: true,
    schema: { type: 'object', properties: { summary: { type: 'string' }, highlights: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } }, suggestions: { type: 'array', items: { type: 'string' } } }, required: ['summary'] },
    maxOutputTokens: 3072
  });
  const fallback = { summary: `${people.length} people: ${present} present days, ${late} late arrivals, ${absent} absences and ${facts.lopDays} LOP day(s) in ${month}.`, highlights: [], risks: topLate.slice(0, 3).map((x) => `${x.name}: late ${x.lateDays} day(s), ${x.avgLateMinutes} min on average.`), suggestions: missingOut ? [`${missingOut} day(s) are missing a check-out; remind people to punch out.`] : [] };
  return { usedAi: Boolean(ai.ok), model: ai.model, reason: ai.ok ? undefined : ai.message, data: { ...(ai.ok ? ai.data : fallback), facts } };
}

async function personalAttendanceInsights({ tenantId, user, employeeId, month }) {
  const { buildCalendar } = require('../attendanceCalendarService');
  const cal = await buildCalendar({ tenantId, employeeId, month, selfHeal: false });
  const s = cal.summary;
  const name = `${cal.employee.firstName} ${cal.employee.lastName || ''}`.trim();
  // lateMinutes already leaves out arrivals inside the grace.
  const exceptions = cal.days.filter((d) => !d.isFuture && (['ABSENT', 'HALF_DAY', 'REVIEW'].includes(d.status) || d.missingPunch || d.lateMinutes > 0 || d.earlyLeaveMinutes > 0 || d.lopDays > 0))
    .slice(0, 20)
    .map((d) => ({ date: d.date, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekday], status: d.status, lateMinutes: d.lateMinutes || 0, earlyLeaveMinutes: d.earlyLeaveMinutes || 0, missingPunch: d.missingPunch, lop: d.lopDays }));
  const facts = {
    employee: name, month, shift: cal.days.find((d) => d.shiftName)?.shiftName || null,
    workingDaysSoFar: s.elapsedWorkingDays, workingDaysInMonth: s.workingDays, present: s.present, absent: s.absent, halfDays: s.halfDays, leaveDays: s.leaveDays,
    lateDays: s.lateDays, totalLateMinutes: s.lateMinutes, earlyLeaveDays: s.earlyLeaveDays, missingPunches: s.missingPunches, lopDays: s.lopDays,
    averageCheckIn: s.avgCheckIn || null, averageCheckOut: s.avgCheckOut || null, averageWorkedMinutes: s.avgWorkedMinutes, onTimeRatePercent: s.onTimeRate, attendanceRatePercent: s.attendanceRate,
    pendingRequests: s.pendingRequests, exceptionDays: exceptions
  };
  const ai = await tryAi({
    tenantId, userId: user._id, feature: 'ATTENDANCE',
    system: `${BASE_RULES} You are an HR analyst reviewing one employee's attendance for the month. Be factual, kind and specific; never speculate about personal reasons.`,
    prompt: `Review this month's attendance for ${name}. Facts (JSON): ${JSON.stringify(facts)}.\nReturn JSON: summary (2-3 sentences with the key numbers), highlights (1-3 positives), risks (0-3 concrete patterns, e.g. weekday clusters or missing punches, citing dates), suggestions (1-3 practical actions such as raising a regularization for a missing punch).`,
    json: true,
    schema: { type: 'object', properties: { summary: { type: 'string' }, highlights: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } }, suggestions: { type: 'array', items: { type: 'string' } } }, required: ['summary'] },
    maxOutputTokens: 3072
  });
  const highlights = [];
  if (s.onTimeRate !== null && s.onTimeRate >= 90) highlights.push(`On time on ${s.onTimeRate}% of working days.`);
  if (!s.absent && s.elapsedWorkingDays) highlights.push('No unplanned absences so far this month.');
  if (s.avgWorkedMinutes) highlights.push(`Average day on duty: ${Math.floor(s.avgWorkedMinutes / 60)}h ${String(s.avgWorkedMinutes % 60).padStart(2, '0')}m.`);
  const risks = [];
  if (s.lateDays) risks.push(`${s.lateDays} late arrival(s), ${s.lateMinutes} minutes in total.`);
  if (s.missingPunches) risks.push(`${s.missingPunches} day(s) have only one punch. They carry no loss of pay but wait for HR / admin to decide (set the time, or count the day present, half or absent).`);
  if (s.absent) risks.push(`${s.absent} absent day(s) without approved leave.`);
  const suggestions = [];
  if (s.missingPunches) suggestions.push('Settle each yellow day on the attendance calendar (or send the real time as a correction) before payroll is generated.');
  if (s.absent) suggestions.push('Apply leave for absent days if leave balance is available, to avoid loss of pay.');
  if (s.lateDays >= 3) suggestions.push('The monthly late/early exception quota may be used up; further late arrivals attract 0.5 day LOP.');
  const fallback = {
    summary: `${name}: ${s.present} present, ${s.absent} absent, ${s.halfDays} half day(s) and ${s.leaveDays} leave day(s) in ${s.elapsedWorkingDays} working day(s) so far; ${s.lopDays} LOP day(s).`,
    highlights, risks, suggestions
  };
  return { usedAi: Boolean(ai.ok), model: ai.model, reason: ai.ok ? undefined : ai.message, data: { ...(ai.ok ? ai.data : fallback), facts } };
}

/* ------------------------------------------------------------------ */
/* Probation                                                            */
/* ------------------------------------------------------------------ */
async function probationReview({ tenantId, user, employee, employeeId, notes }) {
  const emp = await Employee.findOne({ _id: employeeId, tenantId }).select('firstName lastName employeeCode department designation dateOfJoining probation').lean();
  if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
  // Admins review anyone; everyone else only people inside their attendance
  // scope (their team), and never their own probation.
  if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role)) {
    if (employee?._id && String(employee._id) === String(emp._id)) throw Object.assign(new Error('You cannot draft your own probation review'), { status: 403 });
    const scope = new Set((await getScopedEmployeeIds({ user, employee, resource: 'ATTENDANCE' })).map(String));
    if (!scope.has(String(emp._id))) throw Object.assign(new Error('This employee is outside your team'), { status: 403 });
  }
  const since = emp.probation?.startDate || emp.dateOfJoining || new Date(Date.now() - 180 * 86400000);
  const [rows, leaves] = await Promise.all([
    Attendance.find({ tenantId, employeeId: emp._id, date: { $gte: since } }).select('status lateMinutes earlyLeaveMinutes lopDays').lean(),
    LeaveRequest.find({ tenantId, employeeId: emp._id, status: 'APPROVED', fromDate: { $gte: since } }).select('days leaveType').lean()
  ]);
  const facts = {
    employee: fullName(emp), designation: emp.designation, department: emp.department,
    probationStart: semanticDateKey(since), probationEnd: emp.probation?.endDate ? semanticDateKey(emp.probation.endDate) : null,
    workingDaysRecorded: rows.filter((r) => !['WEEK_OFF', 'HOLIDAY'].includes(r.status)).length,
    presentDays: rows.filter((r) => ['PRESENT', 'WFH'].includes(r.status)).length,
    halfDays: rows.filter((r) => r.status === 'HALF_DAY').length,
    absentDays: rows.filter((r) => r.status === 'ABSENT').length,
    lateDays: rows.filter((r) => Number(r.lateMinutes) > 0).length,
    lopDays: rows.reduce((s, r) => s + Number(r.lopDays || 0), 0),
    approvedLeaveDays: leaves.reduce((s, l) => s + Number(l.days || 0), 0),
    managerNotes: String(notes || '').slice(0, 1500)
  };
  const ai = await tryAi({
    tenantId, userId: user._id, feature: 'PROBATION',
    system: `${BASE_RULES} You draft a probation review for a manager to edit. Attendance alone is not performance; weigh manager notes most.`,
    prompt: `Draft a probation confirmation review. Facts (JSON): ${JSON.stringify(facts)}.\nReturn JSON: summary (3-4 sentences), recommendation ("Confirm", "Extend probation" or "Discuss with HR"), strengths (2-4), improvements (1-3), remarksDraft (2-3 sentences the manager can paste as decision remarks).`,
    json: true,
    schema: { type: 'object', properties: { summary: { type: 'string' }, recommendation: { type: 'string' }, strengths: { type: 'array', items: { type: 'string' } }, improvements: { type: 'array', items: { type: 'string' } }, remarksDraft: { type: 'string' } }, required: ['summary', 'recommendation'] },
    maxOutputTokens: 3072
  });
  if (!ai.ok) return { usedAi: false, reason: ai.message, data: { ...probationFallback(facts), facts } };
  return { usedAi: true, model: ai.model, data: { ...ai.data, facts } };
}

// Plain-rules draft used when Gemini is off, so managers still get a starting point.
function probationFallback(f) {
  const worked = Math.max(1, f.workingDaysRecorded);
  const presence = Math.round(((f.presentDays + f.halfDays * 0.5) / worked) * 100);
  const lateShare = Math.round((f.lateDays / worked) * 100);
  const strengths = [];
  const improvements = [];
  if (presence >= 90) strengths.push(`Attendance is strong at about ${presence}% of recorded working days.`);
  if (f.lateDays === 0 && f.workingDaysRecorded > 0) strengths.push('No late arrivals recorded during probation.');
  if (f.absentDays === 0 && f.workingDaysRecorded > 0) strengths.push('No unplanned absences recorded.');
  if (presence < 85) improvements.push(`Attendance is about ${presence}% of recorded working days; discuss reliability.`);
  if (lateShare >= 15) improvements.push(`Late on ${f.lateDays} day(s) (${lateShare}% of working days).`);
  if (f.absentDays > 2) improvements.push(`${f.absentDays} unplanned absence(s) recorded.`);
  if (f.lopDays > 0) improvements.push(`${f.lopDays} loss-of-pay day(s) during probation.`);
  if (!strengths.length) strengths.push('Add the manager\'s observations on work quality, ownership and teamwork.');
  if (!improvements.length) improvements.push('No attendance concerns; add any performance goals for the next quarter.');
  const recommendation = f.workingDaysRecorded < 20 ? 'Discuss with HR' : (presence >= 85 && f.absentDays <= 2 ? 'Confirm' : 'Extend probation');
  return {
    summary: `${f.employee} (${f.designation || 'employee'}, ${f.department || 'department not set'}) has ${f.workingDaysRecorded} working day(s) recorded since ${f.probationStart}: ${f.presentDays} present, ${f.halfDays} half day(s), ${f.absentDays} absent and ${f.approvedLeaveDays} approved leave day(s). Attendance alone does not measure performance, so add your own assessment before deciding.`,
    recommendation,
    strengths,
    improvements,
    remarksDraft: `Attendance during probation was about ${presence}% of recorded working days with ${f.lateDays} late day(s). ${recommendation === 'Confirm' ? 'Recommended for confirmation.' : recommendation === 'Extend probation' ? 'Recommend extending probation to review progress.' : 'To be discussed with HR before a decision.'}`,
    note: 'Drafted from attendance rules because Gemini is not configured.'
  };
}

/* ------------------------------------------------------------------ */
/* HR digest (scheduler)                                                */
/* ------------------------------------------------------------------ */
async function dailyDigestText({ tenantId, facts }) {
  const ai = await tryAi({
    tenantId, feature: 'BRIEFING',
    system: `${BASE_RULES} You write a 3-5 sentence daily HR digest for the HR head.`,
    prompt: `Facts (JSON): ${JSON.stringify(facts)}. Return only the digest text.`,
    maxOutputTokens: 1536
  });
  return ai.ok ? ai.text : null;
}

module.exports = {
  dailyBriefing, jobDescription, screenCandidate, interviewQuestions, noticeDraft, translate, polish,
  composeMessage, draftDocument, leaveInsight, payrollReview, explainPayslip, attendanceInsights,
  probationReview, dailyDigestText, istTodayKey, dayWindow, LANGUAGES
};
