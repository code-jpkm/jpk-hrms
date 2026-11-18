const dotenv = require('dotenv');
dotenv.config();

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

const port = Number(process.env.PORT || 3000);

// v27: the website and the API are one Next.js app, so one public address
// serves both. Render sets RENDER_EXTERNAL_URL by itself; APP_URL wins when set
// (for a custom domain). Used for links in emails / WhatsApp and for the
// attendance-machine setup card.
const appUrl = trimSlash(
  process.env.APP_URL
  || process.env.CLIENT_URL
  || process.env.RENDER_EXTERNAL_URL
  || `http://localhost:${port}`
);

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/hrms_full_system',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  jwtSecretIsDefault: !process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  appUrl,
  // Kept under the old names so every existing caller keeps working.
  clientUrl: appUrl,
  // Extra websites allowed to call the API from a browser (comma separated).
  // The app's own pages are always allowed (same origin).
  clientUrls: String(process.env.CLIENT_URLS || '').split(',').map((v) => trimSlash(v)).filter(Boolean),
  publicApiUrl: trimSlash(process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || appUrl),
  login: {
    // Picture captcha on sign-in and forgot-password. "off" only for local tests.
    captcha: String(process.env.LOGIN_CAPTCHA || 'on').toLowerCase() !== 'off',
    captchaSecret: process.env.CAPTCHA_SECRET || '',
    lockAfterFailures: Number(process.env.LOGIN_LOCK_AFTER || 5),
    lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES || 15),
    resetLinkMinutes: Number(process.env.PASSWORD_RESET_MINUTES || 30)
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379)
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'HRMS <no-reply@example.com>'
  },
  maytapi: {
    baseUrl: process.env.MAYTAPI_BASE_URL || 'https://api.maytapi.com/api',
    productId: process.env.MAYTAPI_PRODUCT_ID || '',
    phoneId: process.env.MAYTAPI_PHONE_ID || '',
    token: process.env.MAYTAPI_TOKEN || ''
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 20000)
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'jpk-hrms'
  }
};
