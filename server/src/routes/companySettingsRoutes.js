const router = require('express').Router();
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/companySettingsController');

router.use(auth);
router.get('/public', controller.publicSettings);
router.get('/', requireAbility('COMPANY_SETTINGS', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.getCompanySettings);
router.put('/geofence-sites', requireAbility('COMPANY_SETTINGS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.saveGeofenceSites);

module.exports = router;
