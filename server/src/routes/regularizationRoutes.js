const router = require('express').Router();
const { auth } = require('../middleware/auth');
const controller = require('../controllers/regularizationController');

router.use(auth);
router.get('/', controller.list);
router.post('/apply', controller.apply);
router.post('/:id/decision', controller.decision);

module.exports = router;
