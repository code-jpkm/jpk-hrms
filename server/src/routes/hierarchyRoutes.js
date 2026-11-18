const router = require('express').Router();
const { auth, requireRoles, requireAbility } = require('../middleware/auth');
const controller = require('../controllers/hierarchyController');

router.use(auth);
router.get('/', requireAbility('HIERARCHY', 'READ', 'SUPER_ADMIN', 'HR_ADMIN'), controller.tree);
router.post('/manager', requireAbility('HIERARCHY', 'MANAGE', 'SUPER_ADMIN', 'HR_ADMIN'), controller.updateManager);

module.exports = router;
