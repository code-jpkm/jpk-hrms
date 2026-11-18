const router = require('express').Router();
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/attendanceController');

router.use(auth);
router.get('/', controller.listAttendance);
router.get('/employees', controller.employees);
router.get('/calendar', controller.calendar);
router.get('/team-today', controller.teamToday);
router.get('/mobile-state', controller.mobileState);
router.post('/mobile-check-in', controller.mobileCheckIn);
router.post('/mobile-check-out', controller.mobileCheckOut);
router.post('/import-biometric', requireAbility('ATTENDANCE', 'IMPORT', 'SUPER_ADMIN', 'HR_ADMIN'), controller.importBiometric);
router.post('/override', requireAbility('ATTENDANCE', 'OVERRIDE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.overrideAttendance);
router.post('/lop-override', requireAbility('ATTENDANCE', 'OVERRIDE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.overrideLop);
router.post('/evaluate-month', requireAbility('ATTENDANCE', 'EVALUATE', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'), controller.evaluateMonth);

module.exports = router;
