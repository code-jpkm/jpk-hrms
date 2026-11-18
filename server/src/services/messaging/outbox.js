/**
 * Persistent outbox for email and WhatsApp.
 *
 * Controllers only *enqueue* (one fast insert), so an approval click never
 * waits on SMTP or WhatsApp. A single in-process worker claims due rows,
 * sends them, and retries transient failures with back-off (1 min, 5 min,
 * 15 min). Claiming uses findOneAndUpdate, so two server instances never
 * send the same row twice.
 */
const NotificationLog = require('../../models/NotificationLog');
const { getConfig } = require('../integrationConfigService');
const { sendEmailVia, sendWhatsappVia } = require('./providers');

const BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const STALE_LOCK_MS = 5 * 60 * 1000;
let timer = null;
let running = false;

function isTransient(message = '') {
  return /timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|network|fetch failed|\b429\b|\b5\d\d\b|rate limit|temporarily/i.test(message);
}

async function enqueue(fields) {
  try {
    return await NotificationLog.create({ status: 'QUEUED', nextAttemptAt: new Date(), ...fields });
  } catch (error) {
    if (error && error.code === 11000 && fields.dedupeKey) {
      // Same event already messaged this person: keep the first one.
      return NotificationLog.findOne({ tenantId: fields.tenantId, dedupeKey: fields.dedupeKey });
    }
    throw error;
  }
}

const REDACTED = '[Removed after sending: this message contained login details]';

async function finish(log, patch) {
  // Messages with a temporary password or reset link keep only their status once
  // they are done; the secret text never stays in the history.
  if (log.meta?.sensitive && ['SENT', 'SKIPPED', 'FAILED'].includes(patch.status)) {
    patch = { ...patch, body: REDACTED, html: `<p>${REDACTED}</p>`, 'template.params': [] };
  }
  const update = { $set: { ...patch, lockedAt: null } };
  // Keep attachment bytes on FAILED/SKIPPED so a manual retry still attaches the PDF.
  if (patch.status === 'SENT') update.$unset = { 'attachments.$[].contentBase64': '' };
  try {
    await NotificationLog.updateOne({ _id: log._id }, update);
  } catch (_) {
    // $[] fails on documents without attachments in some Mongo versions.
    await NotificationLog.updateOne({ _id: log._id }, { $set: { ...patch, lockedAt: null } });
  }
  return NotificationLog.findById(log._id).lean();
}

async function deliver(log) {
  const config = await getConfig(log.tenantId);
  try {
    if (log.channel === 'EMAIL') {
      if (!config.email.enabled) return finish(log, { status: 'SKIPPED', error: 'Email is switched off in Integrations' });
      if (!config.email.configured) return finish(log, { status: 'SKIPPED', error: 'Email is not configured. Add a provider in Company Settings → Integrations.' });
      const r = await sendEmailVia(config.email, { to: log.to, toName: log.recipientName, subject: log.subject, html: log.html, text: log.body, attachments: log.attachments });
      return finish(log, { status: 'SENT', provider: config.email.provider, providerMessageId: r.providerMessageId, providerResponse: r.response, sentAt: new Date(), error: null });
    }
    if (!config.whatsapp.enabled) return finish(log, { status: 'SKIPPED', error: 'WhatsApp is switched off in Integrations' });
    if (!config.whatsapp.configured) return finish(log, { status: 'SKIPPED', error: 'WhatsApp is not configured. Add Meta Cloud API or Maytapi credentials in Company Settings → Integrations.' });
    const template = config.whatsapp.provider === 'META' && log.template?.name ? log.template : null;
    const doc = (log.attachments || []).find((a) => a.url);
    const r = await sendWhatsappVia(config.whatsapp, { to: log.to, body: log.body, template, document: !template && doc ? { url: doc.url, filename: doc.filename } : null });
    return finish(log, { status: 'SENT', provider: config.whatsapp.provider, providerMessageId: r.providerMessageId, providerResponse: r.response, sentAt: new Date(), error: null });
  } catch (error) {
    const message = String(error.message || error).slice(0, 600);
    const attempts = Number(log.attempts || 1);
    if (isTransient(message) && attempts < Number(log.maxAttempts || 3)) {
      return finish(log, { status: 'QUEUED', error: message, nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]) });
    }
    return finish(log, { status: 'FAILED', error: message });
  }
}

async function claim(filter = {}) {
  return NotificationLog.findOneAndUpdate(
    { status: 'QUEUED', nextAttemptAt: { $lte: new Date() }, ...filter },
    { $set: { status: 'SENDING', lockedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1 }, new: true }
  ).lean();
}

/** Send one specific queued message right now (used by "Send test" and interactive sends). */
async function sendNow(logId) {
  const log = await claim({ _id: logId });
  if (!log) return NotificationLog.findById(logId).lean();
  return deliver(log);
}

async function tick(batch = 15) {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < batch; i += 1) {
      const log = await claim();
      if (!log) break;
      await deliver(log);
    }
  } catch (error) {
    console.error('[outbox] tick failed:', error.message);
  } finally {
    running = false;
  }
}

async function releaseStaleLocks() {
  await NotificationLog.updateMany(
    { status: 'SENDING', lockedAt: { $lt: new Date(Date.now() - STALE_LOCK_MS) } },
    { $set: { status: 'QUEUED', nextAttemptAt: new Date(), lockedAt: null } }
  );
}

function startOutboxWorker({ intervalMs = 4000 } = {}) {
  if (timer) return;
  releaseStaleLocks().catch(() => {});
  timer = setInterval(() => {
    tick().catch(() => {});
  }, intervalMs);
  if (timer.unref) timer.unref();
  setInterval(() => releaseStaleLocks().catch(() => {}), 60 * 1000).unref?.();
}

async function retry(logId, tenantId) {
  const log = await NotificationLog.findOneAndUpdate(
    { _id: logId, tenantId, status: { $in: ['FAILED', 'SKIPPED'] }, 'meta.sensitive': { $ne: true } },
    { $set: { status: 'QUEUED', nextAttemptAt: new Date(), error: null, attempts: 0 } },
    { new: true }
  );
  if (!log) return null;
  return sendNow(log._id);
}

/** History rows for screens: login details are never shown, even while queued. */
function maskForDisplay(row) {
  if (!row || !row.meta?.sensitive) return row;
  const plain = typeof row.toObject === 'function' ? row.toObject() : { ...row };
  return { ...plain, body: REDACTED, html: plain.html ? `<p>${REDACTED}</p>` : plain.html, template: plain.template ? { ...plain.template, params: [] } : plain.template };
}

module.exports = { enqueue, sendNow, tick, startOutboxWorker, retry, maskForDisplay, REDACTED };
