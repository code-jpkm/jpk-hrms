const router = require('express').Router();
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/leaveController');

router.use(auth);
router.get('/employees', controller.employees);
router.get('/policies', controller.policies);
router.post('/policies', requireAbility('LEAVE', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.savePolicy);
router.get('/grants', controller.grants);
router.post('/grant', requireAbility('LEAVE', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.grant);
router.get('/balances/template.xlsx', requireAbility('LEAVE', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.balanceTemplate);
router.post('/balances/import-excel', requireAbility('LEAVE', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.importBalances);
router.get('/balances', controller.balances);
router.get('/requests', controller.requests);
router.post('/apply', controller.apply);
router.post('/manual-add', requireAbility('LEAVE', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.manualAdd);
router.post('/:id/cancel', controller.cancel);
router.post('/:id/decision', requireAbility('LEAVE', 'APPROVE', 'SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'), controller.decision);

module.exports = router;
