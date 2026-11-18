const router = require('express').Router();
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/notificationController');

router.use(auth);
router.get('/inbox', controller.inbox);
router.post('/inbox/read-all', controller.markAllRead);
router.post('/inbox/:id/read', controller.markRead);
router.get('/logs', requireAbility('SYSTEM', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.logs);

module.exports = router;
