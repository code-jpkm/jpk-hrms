const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/aiController');
const studio = require('../controllers/aiStudioController');

router.use(auth);

// Natural-language HR commands (existing).
router.get('/capabilities', requireAbility('AI', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.capabilities);
router.post('/command', requireAbility('AI', 'COMMAND', 'SUPER_ADMIN', 'HR_ADMIN'), controller.command);
router.get('/logs', requireAbility('AI', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.logs);

// Gemini features used across the modules. Each call costs money, so cap it per user.
const aiLimit = rateLimit({ windowMs: 60 * 1000, max: 20, keyGenerator: (req) => String(req.user?._id || req.ip), standardHeaders: true, legacyHeaders: false, validate: false, message: { message: 'Too many AI requests. Wait a minute and try again.' } });
router.get('/status', studio.status);
router.get('/availability', studio.availability);
router.post('/briefing', aiLimit, studio.briefing);
router.post('/recruitment/job-description', aiLimit, studio.jobDescription);
router.post('/recruitment/candidates/:id/screen', aiLimit, studio.screenCandidate);
router.post('/recruitment/interview-questions', aiLimit, studio.interviewQuestions);
router.post('/notices/draft', aiLimit, studio.noticeDraft);
router.post('/translate', aiLimit, studio.translate);
router.post('/polish', aiLimit, studio.polish);
router.post('/messages/compose', aiLimit, studio.composeMessage);
router.post('/documents/draft', aiLimit, studio.draftDocument);
router.post('/leave/:id/insight', aiLimit, studio.leaveInsight);
router.post('/payroll/review', aiLimit, studio.payrollReview);
router.post('/payroll/slips/:id/explain', aiLimit, studio.explainPayslip);
router.post('/attendance/insights', aiLimit, studio.attendanceInsights);
router.post('/probation/:employeeId/review', aiLimit, studio.probationReview);

module.exports = router;
