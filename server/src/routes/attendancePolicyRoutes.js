const router = require('express').Router();
const { auth, requireRoles, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/attendancePolicyController');

router.use(auth);
router.get('/', requireAbility('ATTENDANCE_RULES', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.getPolicy);
router.post('/', requireAbility('ATTENDANCE_RULES', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.savePolicy);
router.post('/evaluate-month', requireAbility('ATTENDANCE_RULES', 'APPROVE', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'), controller.evaluateMonth);

module.exports = router;
