const router = require('express').Router();
const { auth, requireRoles, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/probationController');

router.use(auth);
router.get('/', requireAbility('PROBATION', 'READ', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'), controller.list);
router.post('/run-reminders', requireAbility('PROBATION', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.runReminderNow);
router.post('/:id/decision', controller.decide);

module.exports = router;
