const { startSchedulers } = require('./jobs/scheduler');
const { startOutboxWorker } = require('./services/messaging/outbox');
const { applyAdminPasswordFromEnv } = require('./services/loginAccessService');

/**
 * Background work that runs next to the web server: scheduled jobs
 * (birthdays, reminders, missing punches…), the email / WhatsApp outbox, and
 * the one-time ADMIN_EMAIL + ADMIN_PASSWORD login setup.
 */
function startBackground() {
  startSchedulers();
  // Email / WhatsApp outbox: sends queued messages every few seconds.
  if (process.env.DISABLE_OUTBOX_WORKER !== 'true') startOutboxWorker();
  applyAdminPasswordFromEnv().catch((error) => console.error('[login] ADMIN_PASSWORD could not be applied:', error.message));
}

module.exports = { startBackground };
