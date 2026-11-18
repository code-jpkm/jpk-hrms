const { startSchedulers } = require('./jobs/scheduler');
const { startOutboxWorker } = require('./services/messaging/outbox');

/**
 * Background work that runs next to the web server: scheduled jobs
 * (birthdays, reminders, missing punches…) and the email / WhatsApp outbox.
 */
function startBackground() {
  startSchedulers();
  // Email / WhatsApp outbox: sends queued messages every few seconds.
  if (process.env.DISABLE_OUTBOX_WORKER !== 'true') startOutboxWorker();
}

module.exports = { startBackground };
