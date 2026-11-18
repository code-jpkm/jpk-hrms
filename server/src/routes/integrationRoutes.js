const router = require('express').Router();
const mongoose = require('mongoose');
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/integrationController');

// Public Meta webhook (verification GET + delivery receipts POST). The tenant id
// in the path tells us which verify token / app secret to check against.
function validTenant(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.tenantId)) return res.sendStatus(404);
  return next();
}
router.get('/whatsapp/webhook/:tenantId', validTenant, controller.webhookVerify);
router.post('/whatsapp/webhook/:tenantId', validTenant, controller.webhookReceive);

router.use(auth);
const canManage = requireAbility('COMPANY_SETTINGS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN');
router.get('/', canManage, controller.get);
router.put('/:section(email|whatsapp|ai|events)', canManage, controller.save);
router.post('/email/test', canManage, controller.testEmail);
router.post('/whatsapp/test', canManage, controller.testWhatsapp);
router.post('/ai/test', canManage, controller.testAi);
router.get('/logs', canManage, controller.logs);
router.get('/logs/:id', canManage, controller.logDetail);
router.post('/logs/:id/retry', canManage, controller.retryLog);
router.get('/ai/usage', canManage, controller.aiUsage);

module.exports = router;
