const express = require('express');
const { auth } = require('../middleware/auth');
const controller = require('../controllers/weatherController');

const router = express.Router();

// Sign-in pages: weather at the company's main site.
router.get('/office', controller.officeWeather);
// Signed in: weather near the device (body { lat, lon }, rounded) or at their workplace.
router.post('/now', auth, controller.weatherNow);

module.exports = router;
