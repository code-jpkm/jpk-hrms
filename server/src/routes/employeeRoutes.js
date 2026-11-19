const router = require('express').Router();
const { auth, requireRoles, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/employeeController');

router.use(auth);
router.get('/', controller.listEmployees);
router.get('/birthdays', controller.birthdays);
router.get('/import-template.xlsx', requireAbility('EMPLOYEES', 'CREATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.employeeImportTemplate);
router.post('/import-excel', requireAbility('EMPLOYEES', 'CREATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.importEmployeesExcel);
router.get('/users', requireAbility('ACCESS', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.listUsers);
router.patch('/users/:userId/permissions', requireAbility('ACCESS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateUserPermissions);
router.get('/access-grants', requireAbility('ACCESS', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.listAccessGrants);
router.delete('/access-grants/:grantId', requireAbility('ACCESS', 'DELETE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.deleteAccessGrant);
router.get('/login-details/summary', requireAbility('EMPLOYEES', 'MANAGE_LOGIN', 'SUPER_ADMIN', 'HR_ADMIN'), controller.loginStatusSummary);
router.get('/login-details/plan', requireAbility('EMPLOYEES', 'MANAGE_LOGIN', 'SUPER_ADMIN', 'HR_ADMIN'), controller.loginDetailsPlan);
router.post('/login-details/send-all', requireAbility('EMPLOYEES', 'MANAGE_LOGIN', 'SUPER_ADMIN', 'HR_ADMIN'), controller.sendLoginDetailsToAll);
router.get('/:id/letters/:type/download', controller.downloadLetter);
router.post('/bulk-import', requireAbility('EMPLOYEES', 'CREATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.bulkUpsertEmployees);
router.post('/', requireAbility('EMPLOYEES', 'CREATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.createEmployee);
router.patch('/:id', requireAbility('EMPLOYEES', 'UPDATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateEmployee);
router.post('/:id/resend-login', requireAbility('EMPLOYEES', 'MANAGE_LOGIN', 'SUPER_ADMIN', 'HR_ADMIN'), controller.resendLogin);
router.post('/:id/offboard', requireAbility('EMPLOYEES', 'DELETE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.offboardEmployee);
router.post('/access-grants', requireAbility('ACCESS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertAccessGrant);
router.post('/:id/access-grants', requireAbility('ACCESS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.upsertAccessGrant);
router.delete('/:id', requireAbility('EMPLOYEES', 'DELETE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.deleteEmployee);

module.exports = router;
