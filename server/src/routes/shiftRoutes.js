const router = require('express').Router();
const { auth, requireRoles, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/shiftController');

router.use(auth);
router.get('/', requireAbility('SHIFTS', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.list);
router.post('/', requireAbility('SHIFTS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.create);
router.post('/bulk', requireAbility('SHIFTS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.bulkCreate);
router.get('/assignments', requireAbility('SHIFTS', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.assignments);
router.post('/assign', requireAbility('SHIFTS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.assign);
router.post('/reprocess-attendance', requireAbility('SHIFTS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.reprocessAttendance);

module.exports = router;
