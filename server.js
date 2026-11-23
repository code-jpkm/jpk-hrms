// JPK HRMS v27 — one Next.js app for the website, the API (/api) and the
// attendance machines (/iclock).
//   development:  npm run dev
//   production:   npm run build  then  npm start
//
// Every date calculation assumes the Node process runs in UTC (as on Render).
// Pin it before anything else loads.
process.env.TZ = process.env.HRMS_SERVER_TZ || 'UTC';

const http = require('http');
const next = require('next');
const mongoose = require('mongoose');
const env = require('./server/src/config/env');

const dev = process.env.NODE_ENV !== 'production';
const port = env.port;
const hostname = process.env.HOST || '0.0.0.0';

// Requests for the API and the attendance machines go to the Express API;
// everything else is a page of the Next.js website.
function isApiRequest(url = '') {
  const path = String(url).split('?')[0].toLowerCase();
  return path === '/api' || path.startsWith('/api/')
    || path === '/iclock' || path.startsWith('/iclock/')
    || path === '/health';
}

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
});

async function main() {
  if (!dev && env.jwtSecretIsDefault) {
    console.error('JWT_SECRET is missing, too short or still an example value. Set a long random JWT_SECRET (24+ characters) in the server settings before starting in production.');
    process.exit(1);
  }
  if (dev && env.jwtSecretIsDefault) console.warn('[warning] JWT_SECRET is missing or an example value: fine for a local test, never for production.');

  const connectDb = require('./server/src/config/db');
  await connectDb();

  // ADMIN_EMAIL + ADMIN_PASSWORD (first start after Google sign-in): ready
  // before the first request, so the Super Admin can sign in straight away.
  await require('./server/src/services/loginAccessService').applyAdminPasswordFromEnv()
    .catch((error) => console.error('[login] ADMIN_PASSWORD could not be applied:', error.message));

  // One-time updates (each runs once, e.g. the Nov 2026 PF / ESI / P.Tax rules).
  await require('./server/src/services/startupUpdates').runStartupUpdates()
    .catch((error) => console.error('[startup] one-time updates failed:', error.message));

  const api = require('./server/src/app');
  const server = http.createServer();
  const nextApp = next({ dev, dir: __dirname, hostname, port, httpServer: server });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  server.on('request', (req, res) => {
    if (isApiRequest(req.url)) return api(req, res);
    return handle(req, res);
  });

  server.listen(port, hostname, () => {
    console.log(`JPK HRMS running on http://localhost:${port} (${dev ? 'development' : 'production'}) — public address ${env.appUrl}`);
  });

  require('./server/src/start').startBackground();

  const shutdown = (signal) => {
    console.log(`${signal} received: closing.`);
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Failed to start JPK HRMS:', error);
  process.exit(1);
});
