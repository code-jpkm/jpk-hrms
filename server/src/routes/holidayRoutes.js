const router = require('express').Router();
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/holidayController');

router.use(auth);
router.get('/', controller.list);
// v26: was open to every signed-in employee.
router.post('/repair-dates', requireAbility('HOLIDAYS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.repairDates);
router.post('/', requireAbility('HOLIDAYS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.create);
router.delete('/:id', requireAbility('HOLIDAYS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.remove);

module.exports = router;
