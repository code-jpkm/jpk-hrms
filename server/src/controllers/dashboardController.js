const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const LeaveRequest = require('../models/LeaveRequest');
const Regularization = require('../models/Regularization');
const Holiday = require('../models/Holiday');
const PayrollRun = require('../models/PayrollRun');
const DashboardLayout = require('../models/DashboardLayout');
const { startOfDay, endOfDay, dateKey, semanticDateKey, holidayDateKey, companyToday } = require('../utils/date');
const { getScopedEmployeeIds } = require('../services/scopeService');
const { hasAbility } = require('../middleware/auth');

exports.summary = asyncHandler(async (req, res) => {
  const [profileScope, attendanceScope, leaveScope] = await Promise.all([
    getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'EMPLOYEE_PROFILE' }),
    getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'ATTENDANCE' }),
    getScopedEmployeeIds({ user: req.user, employee: req.employee, resource: 'LEAVE' })
  ]);

  // The server clock is UTC; "today" must be the India calendar day, or the
  // dashboard shows yesterday's numbers until 05:30 IST.
  const today = companyToday();
  const canReadPayrollOverview = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role) || hasAbility(req.user, 'PAYROLL', 'READ');
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const activeEmployeeQuery = { tenantId: req.tenantId, status: { $ne: 'OFFBOARDED' } };

  const [
    employeeCount,
    attendanceToday,
    pendingLeaves,
    pendingRegularizations,
    upcomingHolidays,
    payrollRuns,
    scopedEmployees,
    attendanceRows,
    leaveRows
  ] = await Promise.all([
    Employee.countDocuments({ ...activeEmployeeQuery, _id: { $in: profileScope } }),
    Attendance.countDocuments({ tenantId: req.tenantId, employeeId: { $in: attendanceScope }, date: { $gte: startOfDay(today), $lte: endOfDay(today) }, $or: [{ status: { $in: ['PRESENT', 'WFH', 'HALF_DAY'] } }, { checkIn: { $ne: null } }] }),
    LeaveRequest.countDocuments({ tenantId: req.tenantId, employeeId: { $in: leaveScope }, status: 'PENDING' }),
    Regularization.countDocuments({ tenantId: req.tenantId, employeeId: { $in: attendanceScope }, status: 'PENDING' }),
    Holiday.find({ tenantId: req.tenantId, date: { $gte: new Date(startOfDay(today).getTime() - 86400000) } }).sort('date').limit(12),
    canReadPayrollOverview ? PayrollRun.find({ tenantId: req.tenantId }).sort('-month').limit(3) : Promise.resolve([]),
    Employee.find({ ...activeEmployeeQuery, _id: { $in: profileScope } }),
    Attendance.find({ tenantId: req.tenantId, employeeId: { $in: attendanceScope }, date: { $gte: monthStart, $lte: endOfDay(today) } }).select('employeeId status lateMinutes earlyLeaveMinutes lopDays'),
    LeaveRequest.find({ tenantId: req.tenantId, employeeId: { $in: leaveScope }, status: 'APPROVED', fromDate: { $lte: endOfDay(today) }, toDate: { $gte: monthStart } }).select('employeeId days')
  ]);

  const attendanceSet = new Set(attendanceScope.map(String));
  const leaveSet = new Set(leaveScope.map(String));
  const stats = new Map(scopedEmployees.map((employee) => [
    String(employee._id),
    {
      employeeId: employee._id,
      employeeCode: employee.employeeCode,
      name: `${employee.firstName} ${employee.lastName || ''}`.trim(),
      department: employee.department,
      workLocation: employee.workLocation,
      present: 0,
      exceptions: 0,
      leaveDays: 0,
      score: 100
    }
  ]));

  attendanceRows.forEach((attendance) => {
    const key = String(attendance.employeeId);
    if (!attendanceSet.has(key)) return;
    const stat = stats.get(key);
    if (!stat) return;
    if (['PRESENT', 'WFH'].includes(attendance.status)) stat.present += 1;
    if (['ABSENT', 'HALF_DAY'].includes(attendance.status) || attendance.lateMinutes || attendance.earlyLeaveMinutes || attendance.lopDays) stat.exceptions += 1;
  });
  leaveRows.forEach((leave) => {
    const key = String(leave.employeeId);
    if (!leaveSet.has(key)) return;
    const stat = stats.get(key);
    if (stat) stat.leaveDays += Number(leave.days || 0);
  });

  // Attendance consistency and approved leave are deliberately shown as separate signals.
  // Approved leave does not reduce the consistency score.
  const teamPerformance = Array.from(stats.values())
    .map((stat) => ({ ...stat, score: Math.max(0, 100 - stat.exceptions * 5) }))
    .sort((a, b) => b.score - a.score);

  const incompleteEmployees = req.user.role === 'SUPER_ADMIN'
    ? scopedEmployees
      .filter((employee) => employee.needsProfileReview || !employee.workLocation || !employee.employeeCategory || !employee.dateOfJoining || !employee.department || !employee.designation)
      .map((employee) => {
        const missing = Array.isArray(employee.profileReviewMissing) && employee.profileReviewMissing.length
          ? employee.profileReviewMissing
          : ['workLocation', 'employeeCategory', 'dateOfJoining', 'department', 'designation'].filter((key) => !employee[key]);
        return {
          _id: employee._id,
          employeeCode: employee.employeeCode,
          name: `${employee.firstName} ${employee.lastName || ''}`.trim(),
          missing,
          workLocation: employee.workLocation,
          employeeCategory: employee.employeeCategory
        };
      })
    : [];

  const canonicalUpcomingHolidays = upcomingHolidays
    .map((holiday) => ({ ...holiday.toObject(), calendarDate: holidayDateKey(holiday) }))
    .filter((holiday) => holiday.calendarDate >= dateKey(today))
    .sort((a, b) => a.calendarDate.localeCompare(b.calendarDate))
    .slice(0, 5)
    .map((holiday) => ({ ...holiday, date: new Date(`${holiday.calendarDate}T00:00:00.000Z`) }));

  function nextOccurrence(sourceDate) {
    const key = semanticDateKey(sourceDate);
    if (!key) return null;
    const [, mm, dd] = key.split('-').map(Number);
    let candidate = new Date(today.getFullYear(), mm - 1, dd);
    const todayOnly = startOfDay(today);
    if (candidate < todayOnly) candidate = new Date(today.getFullYear() + 1, mm - 1, dd);
    return { date: candidate, daysAway: Math.round((startOfDay(candidate) - todayOnly) / 86400000) };
  }

  // Celebrations are company-wide (names only, like the Celebrations page), so
  // an employee's notice board also shows colleagues' birthdays.
  const celebrationPeople = await Employee.find(activeEmployeeQuery).select('firstName lastName dateOfBirth dateOfJoining').lean();
  const myId = String(req.employee?._id || '');
  const whenText = (days) => (days === 1 ? 'tomorrow' : `in ${days} days`);

  const upcomingBirthdays = celebrationPeople
    .filter((e) => e.dateOfBirth)
    .map((e) => ({ employee: e, occurrence: nextOccurrence(e.dateOfBirth) }))
    .filter((x) => x.occurrence && x.occurrence.daysAway <= 14)
    .sort((a, b) => a.occurrence.daysAway - b.occurrence.daysAway)
    .slice(0, 6)
    .map(({ employee: e, occurrence }) => {
      const self = String(e._id) === myId;
      const today0 = occurrence.daysAway === 0;
      return {
        type: 'BIRTHDAY', date: dateKey(occurrence.date), daysAway: occurrence.daysAway, isSelf: self,
        title: today0 ? `🎂 Happy Birthday, ${e.firstName}!` : self ? '🎂 Your birthday is coming up' : `🎂 ${e.firstName} ${e.lastName || ''}`.trim() + ' · birthday coming up',
        body: today0
          ? (self ? 'Everyone here wishes you a wonderful birthday and a great year ahead.' : `Wishing ${e.firstName} a wonderful birthday and a great year ahead.`)
          : (self ? `Your birthday is ${whenText(occurrence.daysAway)}.` : `${e.firstName}'s birthday is ${whenText(occurrence.daysAway)}.`)
      };
    });

  const upcomingAnniversaries = celebrationPeople
    .filter((e) => e.dateOfJoining)
    .map((e) => ({ employee: e, occurrence: nextOccurrence(e.dateOfJoining), joinKey: semanticDateKey(e.dateOfJoining) }))
    .filter((x) => x.occurrence && x.occurrence.daysAway <= 14)
    .map((x) => ({ ...x, years: x.occurrence.date.getFullYear() - Number(x.joinKey.slice(0, 4)) }))
    .filter((x) => x.years > 0)
    .sort((a, b) => a.occurrence.daysAway - b.occurrence.daysAway)
    .slice(0, 6)
    .map(({ employee: e, occurrence, years }) => {
      const self = String(e._id) === myId;
      const yrs = `${years} year${years === 1 ? '' : 's'}`;
      return {
        type: 'ANNIVERSARY', date: dateKey(occurrence.date), daysAway: occurrence.daysAway, years, isSelf: self,
        title: occurrence.daysAway === 0
          ? (self ? `👏 Happy work anniversary, ${e.firstName}!` : `👏 ${e.firstName} completes ${yrs} with us today`)
          : (self ? `👏 Your ${years}-year work anniversary` : `👏 ${e.firstName} ${e.lastName || ''}`.trim() + ` · ${years}-year work anniversary`),
        body: occurrence.daysAway === 0
          ? (self ? `Thank you for ${yrs} of contribution to the team.` : `Thank you, ${e.firstName}, for ${yrs} of contribution to the team.`)
          : (self ? `You complete ${yrs} with us ${whenText(occurrence.daysAway)}.` : `${e.firstName} completes ${yrs} with us ${whenText(occurrence.daysAway)}.`)
      };
    });

  const holidaySmartUpdates = canonicalUpcomingHolidays
    .map((h) => {
      const daysAway = Math.round((startOfDay(new Date(`${h.calendarDate}T12:00:00`)) - startOfDay(today)) / 86400000);
      if (daysAway < 0 || daysAway > 7) return null;
      const when = daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`;
      return {
        type: 'HOLIDAY', date: h.calendarDate, daysAway,
        title: daysAway === 0 ? `🎉 ${h.name} · Holiday today` : `🌤️ Upcoming holiday · ${h.name}`,
        body: daysAway === 0
          ? `Wishing everyone a meaningful ${h.name}. The office calendar marks today as a holiday.`
          : `${h.name} is ${when}, on ${new Date(`${h.calendarDate}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}. Please plan attendance, approvals and handovers accordingly.`
      };
    }).filter(Boolean);

  const smartUpdates = [...holidaySmartUpdates, ...upcomingBirthdays, ...upcomingAnniversaries]
    .sort((a, b) => a.daysAway - b.daysAway || a.type.localeCompare(b.type))
    .slice(0, 10);
  const birthdaysToday = upcomingBirthdays.filter((item) => item.daysAway === 0);

  res.json({
    employeeCount,
    attendanceToday,
    pendingLeaves,
    pendingRegularizations,
    upcomingHolidays: canonicalUpcomingHolidays,
    smartUpdates,
    upcomingBirthdays,
    upcomingAnniversaries,
    payrollRuns,
    birthdaysToday,
    teamPerformance,
    incompleteEmployees,
    workplaceCounts: {
      office: scopedEmployees.filter((employee) => ['OFFICE', 'BOTH'].includes(employee.workLocation)).length,
      factory: scopedEmployees.filter((employee) => ['FACTORY', 'BOTH'].includes(employee.workLocation)).length
    }
  });
});


/**
 * POST /api/dashboard/ai-widget
 *
 * The client already had `api/aiWidgets.js` calling this and silently falling
 * back to a local generator, which is why the studio showed
 * "Route not found: POST /api/dashboard/ai-widget". The endpoint now exists.
 *
 * Gemini returns a widget SPEC (type/title/size/tint/config) — never markup —
 * so a bad model response can never inject anything into the dashboard.
 */
exports.aiWidget = asyncHandler(async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) throw new ApiError(400, 'Describe the widget you want, for example "present headcount today"');

  const ALLOWED_TYPES = ['metric', 'list', 'chart', 'progress', 'note'];
  const ALLOWED_BINDS = [
    'employeeCount', 'attendanceToday', 'pendingLeaves', 'pendingRegularizations',
    'onLeaveToday', 'lateToday', 'absentToday', 'payrollNetTotal', 'openPositions'
  ];

  const { interpretDashboardWidget } = require('../services/geminiService');
  const spec = await interpretDashboardWidget({ prompt, allowedTypes: ALLOWED_TYPES, allowedBinds: ALLOWED_BINDS, tenantId: req.tenantId, userId: req.user._id });

  const widget = {
    type: ALLOWED_TYPES.includes(spec?.type) ? spec.type : 'metric',
    title: String(spec?.title || prompt).slice(0, 60),
    size: ['sm', 'md', 'lg'].includes(spec?.size) ? spec.size : 'sm',
    tint: ['indigo', 'teal', 'amber', 'rose', 'sky', 'violet'].includes(spec?.tint) ? spec.tint : 'indigo',
    config: {
      bind: ALLOWED_BINDS.includes(spec?.config?.bind) ? spec.config.bind : 'attendanceToday',
      label: String(spec?.config?.label || '').slice(0, 40),
      helper: String(spec?.config?.helper || '').slice(0, 60),
      icon: String(spec?.config?.icon || 'Sparkles').slice(0, 30)
    }
  };
  res.json({ widget, source: spec?.used ? 'gemini' : 'fallback' });
});

/**
 * POST /api/dashboard/assistant
 *
 * The corner chat. Questions get answers filtered through the caller's own
 * employee scope, so the chat never reveals someone they cannot already see.
 * Requests to change something (shift, leave, attendance, in / out times) are
 * checked against the caller's own permissions: without permission the chat
 * says so ("contact your administrator / HR"); with it, the chat shows what will
 * change and nothing is saved until POST /assistant/confirm.
 */
exports.assistant = asyncHandler(async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) throw new ApiError(400, 'Ask a question, for example "is Aindrila present today?"');

  const { handleAssistantMessage, preview, ASK_ADMIN } = require('../services/assistantActionService');
  const operator = require('../services/assistantOperatorService');
  const superAdmin = operator.canOperate(req.user);
  const action = await handleAssistantMessage(req, question);
  // The HR tasks (shift, leave, attendance, times) first. For the Super Admin a
  // follow-up question from them goes to the operator instead, which can do more.
  if (action && !(superAdmin && action.kind === 'ASK')) return res.json(action);

  const { answerHrQuestion, classify } = require('../services/hrAssistantService');
  if (superAdmin) {
    // Anything else the Super Admin asks or wants changed: the operator, which
    // works through the whole HRMS API. Plain attendance questions keep the
    // quick answers below.
    if (action || operator.mentionsChange(question) || classify(question) === 'UNKNOWN') {
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8).map((h) => ({ who: h?.who === 'me' ? 'me' : 'bot', text: String(h?.text || '').slice(0, 600) })) : [];
      const out = await operator.runOperator(req, question, history, { preview });
      if (out) return res.json(out);
      // Gemini is off: the HR task's own follow-up question, else say what is missing.
      if (action) return res.json(action);
      if (operator.looksLikeChange(question)) return res.json({ answer: 'To change things from the chat I need Gemini, and it is not set up or not reachable right now (Settings → Integrations → AI).', intent: 'OPERATOR_UNAVAILABLE' });
    }
  } else if (operator.looksLikeChange(question)) {
    // Changes beyond the HR tasks are for the Super Admin only.
    return res.json({ answer: `I can't do that from the chat for you. ${ASK_ADMIN}`, intent: 'ACTION_DENIED', denied: true });
  }
  if (action) return res.json(action);
  const answer = await answerHrQuestion({
    tenantId: req.tenantId,
    user: req.user,
    employee: req.employee,
    question
  });
  res.json(answer);
});

/** POST /api/dashboard/assistant/confirm {token}: saves a change the chat showed (permission checked again). */
exports.assistantConfirm = asyncHandler(async (req, res) => {
  const { confirmAssistantAction } = require('../services/assistantActionService');
  res.json(await confirmAssistantAction(req, req.body?.token));
});

/* ------------------------------------------------------------------ */
/* Per-user widget layout. The client always called these routes, but   */
/* they did not exist, so customised dashboards only lived in one        */
/* browser's localStorage and the console showed a 404 on every visit.   */
/* ------------------------------------------------------------------ */
exports.getLayout = asyncHandler(async (req, res) => {
  const layout = await DashboardLayout.findOne({ tenantId: req.tenantId, userId: req.user._id }).lean();
  res.json({ widgets: Array.isArray(layout?.widgets) ? layout.widgets : [], updatedAt: layout?.updatedAt || null });
});

exports.saveLayout = asyncHandler(async (req, res) => {
  const canCustomise = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role) || hasAbility(req.user, 'DASHBOARD', 'MANAGE');
  if (!canCustomise) throw new ApiError(403, 'You do not have permission to customise the dashboard');
  const widgets = req.body?.widgets;
  if (!Array.isArray(widgets)) throw new ApiError(400, 'widgets must be a list');
  if (widgets.length > 40) throw new ApiError(400, 'A dashboard can hold at most 40 widgets');
  if (widgets.some((w) => !w || typeof w !== 'object' || typeof w.id !== 'string' || typeof w.type !== 'string')) throw new ApiError(400, 'Each widget needs an id and a type');
  if (JSON.stringify(widgets).length > 64 * 1024) throw new ApiError(413, 'Dashboard layout is too large');
  const layout = await DashboardLayout.findOneAndUpdate(
    { tenantId: req.tenantId, userId: req.user._id },
    { $set: { tenantId: req.tenantId, userId: req.user._id, widgets } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ widgets: layout.widgets, updatedAt: layout.updatedAt });
});
