const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { auth } = require('../middleware/auth');
const controller = require('../controllers/messageController');

router.use(auth);
// Wishes are open to every employee, so keep them from being used as a spam cannon.
const wishLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyGenerator: (req) => String(req.user?._id || req.ip), standardHeaders: true, legacyHeaders: false, validate: false });
router.post('/wish', wishLimit, controller.wish);
router.post('/preview', controller.preview);
router.post('/broadcast', controller.broadcast);

module.exports = router;
