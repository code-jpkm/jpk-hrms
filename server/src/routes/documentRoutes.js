const router = require('express').Router();
const { auth, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/documentController');

router.use(auth);
router.get('/', controller.listDocuments);
router.post('/', requireAbility('DOCUMENTS', 'CREATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.uploadDocument);
router.patch('/:id', requireAbility('DOCUMENTS', 'UPDATE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateDocument);
router.get('/:id/download', controller.downloadDocument);
router.delete('/:id', requireAbility('DOCUMENTS', 'DELETE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.deleteDocument);

module.exports = router;
