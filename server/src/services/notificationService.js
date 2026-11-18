/**
 * Backwards-compatible helpers kept for older call sites.
 *
 * Before v26 these sent synchronously with SMTP / Maytapi read only from the
 * environment, sent Indian numbers without the 91 country code, and wrote
 * SKIPPED whenever SMTP_HOST was blank. They now go through the same outbox,
 * provider adapters and settings as services/messaging/dispatcher.notify().
 * New code should call notify() with an event key instead.
 */
const Tenant = require('../models/Tenant');
const { getConfig } = require('./integrationConfigService');
const { enqueue, sendNow } = require('./messaging/outbox');
const { renderEmail } = require('./messaging/emailLayout');
const { normalizeWhatsappNumber } = require('./messaging/phone');

function toAttachment(a) {
  if (!a) return null;
  const content = a.content ?? a.contentBase64;
  return {
    filename: a.filename || 'attachment',
    contentType: a.contentType,
    contentBase64: Buffer.isBuffer(content) ? content.toString('base64') : (typeof content === 'string' ? content : undefined),
    url: a.url || a.path
  };
}

async function sendEmail({ tenantId, to, subject, body, html, attachments = [], event = 'CUSTOM', recipientName, wait = true, createdBy }) {
  let finalHtml = html;
  if (!finalHtml) {
    const tenant = tenantId ? await Tenant.findById(tenantId).select('name').lean() : null;
    finalHtml = renderEmail({ company: tenant?.name || 'JPK HRMS', heading: subject || 'Message from HR', intro: body || '' });
  }
  const log = await enqueue({
    tenantId,
    channel: 'EMAIL',
    event,
    to,
    recipientName,
    subject,
    body,
    html: finalHtml,
    attachments: attachments.map(toAttachment).filter(Boolean),
    createdBy,
    ...(to ? {} : { status: 'SKIPPED', error: 'Recipient email not supplied' })
  });
  return wait && log.status === 'QUEUED' ? sendNow(log._id) : log;
}

async function sendWhatsapp({ tenantId, to, body, event = 'CUSTOM', recipientName, wait = true, createdBy, documentUrl, documentName }) {
  const config = await getConfig(tenantId);
  const number = normalizeWhatsappNumber(to, config.whatsapp.defaultCountryCode);
  const log = await enqueue({
    tenantId,
    channel: 'WHATSAPP',
    event,
    to: number,
    recipientName,
    body,
    attachments: documentUrl ? [{ filename: documentName || 'document.pdf', url: documentUrl }] : [],
    createdBy,
    ...(number ? {} : { status: 'SKIPPED', error: to ? `"${to}" is not a valid mobile number` : 'WhatsApp number not supplied' })
  });
  return wait && log.status === 'QUEUED' ? sendNow(log._id) : log;
}

module.exports = { sendEmail, sendWhatsapp };
