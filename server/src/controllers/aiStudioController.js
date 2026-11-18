/**
 * HTTP layer for the Gemini features in services/ai/aiFeatures.js.
 * Permission checks live here; grounding and prompts live in the service.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const { hasAbility } = require('../middleware/auth');
const features = require('../services/ai/aiFeatures');
const { isAvailable } = require('../services/ai/geminiClient');
const { getConfig } = require('../services/integrationConfigService');

function requireAny(req, checks) {
  if (['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role)) return;
  if (checks.some(([m, a]) => hasAbility(req.user, m, a))) return;
  throw new ApiError(403, 'You do not have permission to use this AI feature');
}

function wrap(fn) {
  return asyncHandler(async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      if (error.status && !error.statusCode) throw new ApiError(error.status, error.message);
      throw error;
    }
  });
}

exports.status = asyncHandler(async (req, res) => {
  const config = await getConfig(req.tenantId);
  res.json({
    enabled: config.ai.enabled,
    configured: config.ai.configured,
    model: config.ai.model,
    features: config.ai.features,
    available: config.ai.enabled && config.ai.configured
  });
});

exports.briefing = wrap((req) => features.dailyBriefing({ tenantId: req.tenantId, user: req.user, employee: req.employee }));

exports.jobDescription = wrap((req) => {
  requireAny(req, [['RECRUITMENT', 'MANAGE'], ['RECRUITMENT', 'READ']]);
  return features.jobDescription({ tenantId: req.tenantId, userId: req.user._id, input: req.body || {} });
});

exports.screenCandidate = wrap((req) => {
  requireAny(req, [['RECRUITMENT', 'MANAGE'], ['RECRUITMENT', 'READ']]);
  return features.screenCandidate({ tenantId: req.tenantId, userId: req.user._id, candidateId: req.params.id, resumeText: req.body?.resumeText });
});

exports.interviewQuestions = wrap((req) => {
  requireAny(req, [['RECRUITMENT', 'MANAGE'], ['RECRUITMENT', 'READ']]);
  return features.interviewQuestions({ tenantId: req.tenantId, userId: req.user._id, input: req.body || {} });
});

exports.noticeDraft = wrap((req) => {
  requireAny(req, [['NOTICES', 'MANAGE']]);
  return features.noticeDraft({ tenantId: req.tenantId, userId: req.user._id, input: req.body || {} });
});

exports.translate = wrap((req) => features.translate({ tenantId: req.tenantId, userId: req.user._id, text: req.body?.text, target: req.body?.target }));

exports.polish = wrap((req) => features.polish({ tenantId: req.tenantId, userId: req.user._id, text: req.body?.text, purpose: req.body?.purpose }));

exports.composeMessage = wrap((req) => features.composeMessage({
  tenantId: req.tenantId,
  userId: req.user._id,
  purpose: String(req.body?.purpose || 'CUSTOM').toUpperCase(),
  employeeId: req.body?.employeeId,
  tone: req.body?.tone,
  channel: String(req.body?.channel || 'EMAIL').toUpperCase(),
  extra: req.body?.extra,
  fromName: req.user.name
}));

exports.draftDocument = wrap((req) => {
  requireAny(req, [['DOCUMENTS', 'MANAGE'], ['DOCUMENT_TEMPLATES', 'MANAGE'], ['RECRUITMENT', 'MANAGE']]);
  return features.draftDocument({ tenantId: req.tenantId, userId: req.user._id, input: req.body || {} });
});

exports.leaveInsight = wrap((req) => {
  // Managers approve their team's leave by role (no explicit LEAVE ability), and
  // leaveInsight itself refuses requests outside the caller's scope.
  if (req.user.role !== 'MANAGER') requireAny(req, [['LEAVE', 'APPROVE'], ['LEAVE', 'MANAGE']]);
  return features.leaveInsight({ tenantId: req.tenantId, user: req.user, employee: req.employee, requestId: req.params.id });
});

exports.payrollReview = wrap((req) => {
  requireAny(req, [['PAYROLL', 'RUN'], ['PAYROLL', 'MANAGE'], ['PAYROLL', 'READ']]);
  return features.payrollReview({ tenantId: req.tenantId, user: req.user, month: req.body?.month || req.query.month });
});

exports.explainPayslip = wrap((req) => features.explainPayslip({ tenantId: req.tenantId, user: req.user, employee: req.employee, slipId: req.params.id }));

exports.attendanceInsights = wrap((req) => features.attendanceInsights({ tenantId: req.tenantId, user: req.user, employee: req.employee, month: req.body?.month || req.query.month, employeeId: req.body?.employeeId || req.query.employeeId }));

exports.probationReview = wrap((req) => {
  if (req.user.role !== 'MANAGER') requireAny(req, [['PROBATION', 'MANAGE'], ['PROBATION', 'APPROVE']]);
  return features.probationReview({ tenantId: req.tenantId, user: req.user, employee: req.employee, employeeId: req.params.employeeId, notes: req.body?.notes });
});

exports.availability = asyncHandler(async (req, res) => {
  res.json({ available: await isAvailable(req.tenantId, String(req.query.feature || '').toUpperCase() || undefined) });
});
