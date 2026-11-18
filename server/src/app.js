const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
// Render, Railway, Nginx etc. sit in front of Node. Without this every user
// shares the proxy's IP, so the global rate limit below throttles the whole
// company at once and express-rate-limit logs ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
// Query values are plain strings (or arrays for repeated keys), never objects:
// with the default "extended" parser `?status[$ne]=x` reached Mongo filters as
// an operator. Neither the web client, the native app nor the bridges send
// bracketed query keys.
app.set('query parser', 'simple');
// Attendance machines in "ADMS / Cloud Server" mode send punches here by
// themselves. Mounted before the JSON parsers and the API rate limit: they send
// plain text and check in every half minute.
app.use('/iclock', require('./routes/admsRoutes'));
app.use(helmet());
app.use(compression());
// v27: the website is served by this same app, so its own pages are always
// allowed (same origin). CLIENT_URLS lists any other website that may call it.
function sameOrigin(req, origin) {
  try {
    return new URL(origin).host === String(req.headers.host || '').trim();
  } catch (_) {
    return false;
  }
}
app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  // Native apps and server-to-server clients do not send an Origin header.
  if (!origin || sameOrigin(req, origin) || env.clientUrls.includes('*') || env.clientUrls.includes(origin)) {
    return callback(null, { origin: true, credentials: true });
  }
  const error = new Error(`CORS blocked origin: ${origin}. Add it to CLIENT_URLS on the server.`);
  error.statusCode = 403;
  return callback(error);
}));
app.use(express.json({
  limit: '25mb',
  // Meta signs the raw request body of WhatsApp webhooks; keep a copy for verification.
  verify(req, res, buf) {
    if (req.originalUrl && req.originalUrl.startsWith('/api/integrations/whatsapp/webhook')) req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(rateLimit({ windowMs: 60 * 1000, max: Number(process.env.RATE_LIMIT_PER_MINUTE || 300), standardHeaders: true, legacyHeaders: false }));

const BUILD = 'v27.0';
app.get('/health', (req, res) => res.json({ ok: true, service: 'hrms-api', build: BUILD }));

/**
 * Answers "is the server I am hitting actually the build I just installed?".
 * A stale nodemon process is indistinguishable from a missing route otherwise —
 * both look like a 404 in the browser.
 */
app.get('/api/_version', (req, res) => {
  res.json({ build: BUILD, startedAt: START, mountedRoutes: ROUTE_TABLE.map(([p]) => p) });
});
const START = new Date().toISOString();
// Single source of truth: this table both mounts the routers and is reported by
// GET /api/_version, so the version endpoint can never drift from reality.
const ROUTE_TABLE = [
  ['/api/auth', './routes/authRoutes'],
  ['/api/dashboard', './routes/dashboardRoutes'],
  ['/api/employees', './routes/employeeRoutes'],
  ['/api/attendance', './routes/attendanceRoutes'],
  ['/api/attendance-policy', './routes/attendancePolicyRoutes'],
  ['/api/permissions', './routes/permissionRoutes'],
  ['/api/hierarchy', './routes/hierarchyRoutes'],
  ['/api/probation', './routes/probationRoutes'],
  ['/api/biometric', './routes/biometricRoutes'],
  ['/api/leaves', './routes/leaveRoutes'],
  ['/api/regularizations', './routes/regularizationRoutes'],
  ['/api/holidays', './routes/holidayRoutes'],
  ['/api/shifts', './routes/shiftRoutes'],
  ['/api/payroll', './routes/payrollRoutes'],
  ['/api/notifications', './routes/notificationRoutes'],
  ['/api/notices', './routes/noticeRoutes'],
  ['/api/company-settings', './routes/companySettingsRoutes'],
  ['/api/documents', './routes/documentRoutes'],
  ['/api/document-templates', './routes/documentTemplateRoutes'],
  ['/api/recruitment', './routes/recruitmentRoutes'],
  ['/api/ai', './routes/aiRoutes'],
  ['/api/integrations', './routes/integrationRoutes'],
  ['/api/messages', './routes/messageRoutes']
];
for (const [path, modulePath] of ROUTE_TABLE) app.use(path, require(modulePath));

app.use(notFound);
app.use(errorHandler);

// Printed once at boot so a stale process is obvious in the terminal.
console.log(`[HRMS] API build ${BUILD} — ${ROUTE_TABLE.length} route groups mounted`);

module.exports = app;
