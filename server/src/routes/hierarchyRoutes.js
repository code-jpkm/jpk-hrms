const router = require('express').Router();
const { auth, requireRoles, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/hierarchyController');

router.use(auth);
router.get('/', requireAbility('HIERARCHY', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.tree);
// The chart as a PDF, in the view on screen (tree or list), one team or everyone.
router.post('/chart.pdf', requireAbility('HIERARCHY', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.chartPdf);
router.get('/chart.pdf', requireAbility('HIERARCHY', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.chartPdf);
router.post('/manager', requireAbility('HIERARCHY', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateManager);

module.exports = router;
