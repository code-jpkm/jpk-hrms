const router = require('express').Router();
const { auth } = require('../middleware/auth');
const controller = require('../controllers/dashboardController');

router.use(auth);
router.get('/home', require('../controllers/homeController').home);
router.get('/summary', controller.summary);
router.get('/layout', controller.getLayout);
router.put('/layout', controller.saveLayout);
router.post('/ai-widget', controller.aiWidget);
router.post('/assistant', controller.assistant);
router.post('/assistant/confirm', controller.assistantConfirm);

module.exports = router;
