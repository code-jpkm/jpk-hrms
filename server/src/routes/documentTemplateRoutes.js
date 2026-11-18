const router = require('express').Router();
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/documentTemplateController');

// Designing company letterheads and payslip formats is a Super Admin / HR
// function. Reading is opened to anyone who can already read documents so the
// issue-document action works from the employee screens.
const manage = requireAbility('DOCUMENTS', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN');

router.use(auth);
router.get('/types', controller.types);
router.get('/', controller.list);
router.post('/', manage, controller.create);
router.post('/preview', manage, controller.preview);
router.post('/issue', controller.issue);
router.post('/issue/send', controller.sendIssued);
router.get('/:id', controller.get);
router.patch('/:id', manage, controller.update);
router.post('/:id/duplicate', manage, controller.duplicate);
router.post('/:id/activate', manage, controller.activate);
// v26: was open to every signed-in user and rendered any employee's data (incl. payslips).
router.get('/:id/preview', manage, controller.preview);
router.delete('/:id', manage, controller.remove);

module.exports = router;
