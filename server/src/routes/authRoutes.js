const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { auth } = require('../middleware/auth');
const controller = require('../controllers/authController');

// Counts only failed attempts, so a whole office signing in at 9:00 from one
// internet connection is never blocked; a password-guessing script is.
const signInLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_FAILURES_PER_15_MIN || 40),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many failed sign-in attempts from this network. Wait 15 minutes and try again.' }
});
const captchaLimit = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.CAPTCHA_PER_MINUTE || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many new pictures requested. Wait a minute and try again.' }
});

// Reset links go out by email / WhatsApp: cap how many one network can ask for.
const resetRequestLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RESET_REQUESTS_PER_15_MIN || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many reset requests from this network. Wait 15 minutes and try again.' }
});

router.get('/captcha', captchaLimit, controller.captcha);
router.post('/login', signInLimit, controller.login);
router.post('/forgot-password', resetRequestLimit, controller.forgotPassword);
router.post('/reset-password', signInLimit, controller.resetPassword);
router.post('/change-password', auth, controller.changePassword);
router.get('/me', auth, controller.me);

module.exports = router;
