/**
 * Thin, dependency-free adapters for the delivery providers the HRMS supports.
 * Each function throws an Error whose message is safe to show to an admin,
 * and returns { providerMessageId, response } on success.
 *
 * Email:    SMTP (nodemailer) · Brevo API · Resend API · SendGrid API
 * WhatsApp: Meta WhatsApp Cloud API (official) · Maytapi
 *
 * Why HTTP APIs as well as SMTP: Render's free instances block outbound SMTP
 * ports 25/465/587 (since Sept 2025), so SMTP silently times out there.
 * Brevo/Resend/SendGrid send over HTTPS port 443 and keep working.
 */
const nodemailer = require('nodemailer');

const TIMEOUT_MS = 20000;
const transporters = new Map();

function friendlySmtpError(error) {
  const code = error.code || '';
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET'].includes(code) || /timeout/i.test(error.message)) {
    return 'Could not connect to the SMTP server (connection timed out). If the HRMS runs on a host that blocks SMTP ports, such as Render\'s free plan, switch the email provider to Brevo, Resend or SendGrid.';
  }
  if (code === 'EAUTH') return 'The SMTP server rejected the username or password. For Gmail / Google Workspace use an App Password, not the normal password.';
  if (code === 'EENVELOPE') return `The recipient address was rejected: ${error.message}`;
  return error.message;
}

async function readJson(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch (_) { return { raw: text.slice(0, 500) }; }
}

function fromHeader(cfg) {
  const email = cfg.fromEmail || cfg.smtp?.user;
  return cfg.fromName ? `${cfg.fromName.replace(/[<>"]/g, '')} <${email}>` : email;
}

async function sendSmtp(cfg, msg) {
  const sig = `${cfg.smtp.host}|${cfg.smtp.port}|${cfg.smtp.secure}|${cfg.smtp.user}|${cfg.smtp.pass ? cfg.smtp.pass.length : 0}`;
  let transporter = transporters.get(sig);
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.smtp.host,
      port: cfg.smtp.port,
      secure: Boolean(cfg.smtp.secure),
      auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 25000
    });
    transporters.set(sig, transporter);
  }
  try {
    const info = await transporter.sendMail({
      from: fromHeader(cfg),
      to: msg.toName ? `${msg.toName.replace(/[<>"]/g, '')} <${msg.to}>` : msg.to,
      replyTo: cfg.replyTo || undefined,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: (msg.attachments || []).map((a) => ({ filename: a.filename, content: a.contentBase64 ? Buffer.from(a.contentBase64, 'base64') : undefined, path: a.contentBase64 ? undefined : a.url, contentType: a.contentType }))
    });
    return { providerMessageId: info.messageId, response: { accepted: info.accepted, rejected: info.rejected, response: info.response } };
  } catch (error) {
    transporters.delete(sig);
    throw new Error(friendlySmtpError(error));
  }
}

async function sendBrevo(cfg, msg) {
  const base = process.env.BREVO_BASE_URL || 'https://api.brevo.com/v3';
  const res = await fetch(`${base}/smtp/email`, {
    method: 'POST',
    headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      sender: { name: cfg.fromName || undefined, email: cfg.fromEmail },
      to: [{ email: msg.to, name: msg.toName || undefined }],
      replyTo: cfg.replyTo ? { email: cfg.replyTo } : undefined,
      subject: msg.subject,
      htmlContent: msg.html,
      textContent: msg.text,
      attachment: (msg.attachments || []).filter((a) => a.contentBase64 || a.url).map((a) => (a.contentBase64 ? { name: a.filename, content: a.contentBase64 } : { name: a.filename, url: a.url }))
    })
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${data.message || data.code || data.raw || 'request failed'}`);
  return { providerMessageId: data.messageId, response: data };
}

async function sendResend(cfg, msg) {
  const base = process.env.RESEND_BASE_URL || 'https://api.resend.com';
  const res = await fetch(`${base}/emails`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      from: fromHeader(cfg),
      to: [msg.to],
      reply_to: cfg.replyTo || undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: (msg.attachments || []).filter((a) => a.contentBase64 || a.url).map((a) => (a.contentBase64 ? { filename: a.filename, content: a.contentBase64 } : { filename: a.filename, path: a.url }))
    })
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || data.name || data.raw || 'request failed'}`);
  return { providerMessageId: data.id, response: data };
}

async function sendSendgrid(cfg, msg) {
  const base = process.env.SENDGRID_BASE_URL || 'https://api.sendgrid.com';
  const res = await fetch(`${base}/v3/mail/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to, name: msg.toName || undefined }] }],
      from: { email: cfg.fromEmail, name: cfg.fromName || undefined },
      reply_to: cfg.replyTo ? { email: cfg.replyTo } : undefined,
      subject: msg.subject,
      content: [{ type: 'text/plain', value: msg.text || ' ' }, ...(msg.html ? [{ type: 'text/html', value: msg.html }] : [])],
      attachments: (msg.attachments || []).filter((a) => a.contentBase64).map((a) => ({ content: a.contentBase64, filename: a.filename, type: a.contentType || 'application/octet-stream', disposition: 'attachment' }))
    })
  });
  if (!res.ok) {
    const data = await readJson(res);
    throw new Error(`SendGrid ${res.status}: ${data.errors?.[0]?.message || data.raw || 'request failed'}`);
  }
  return { providerMessageId: res.headers.get('x-message-id') || undefined, response: { status: res.status } };
}

async function sendEmailVia(cfg, msg) {
  if (!msg.to) throw new Error('Recipient email address is missing');
  switch (cfg.provider) {
    case 'BREVO': return sendBrevo(cfg, msg);
    case 'RESEND': return sendResend(cfg, msg);
    case 'SENDGRID': return sendSendgrid(cfg, msg);
    default: return sendSmtp(cfg, msg);
  }
}

/** Meta forbids newlines, tabs and runs of 5+ spaces inside template parameters. */
function cleanTemplateParam(value) {
  const s = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return (s || '-').slice(0, 900);
}

async function sendMeta(cfg, msg) {
  const base = process.env.WHATSAPP_GRAPH_BASE_URL || 'https://graph.facebook.com';
  const version = cfg.meta.apiVersion || 'v26.0';
  let payload;
  if (msg.template?.name) {
    payload = {
      messaging_product: 'whatsapp',
      to: msg.to,
      type: 'template',
      template: {
        name: msg.template.name,
        language: { code: msg.template.language || cfg.meta.templateLanguage || 'en' },
        components: msg.template.params?.length ? [{ type: 'body', parameters: msg.template.params.map((t) => ({ type: 'text', text: cleanTemplateParam(t) })) }] : []
      }
    };
  } else if (msg.document?.url) {
    payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: msg.to, type: 'document', document: { link: msg.document.url, filename: msg.document.filename, caption: String(msg.body || '').slice(0, 1024) } };
  } else {
    payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: msg.to, type: 'text', text: { preview_url: true, body: String(msg.body || '').slice(0, 4096) } };
  }
  const res = await fetch(`${base}/${version}/${encodeURIComponent(cfg.meta.phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.meta.accessToken}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify(payload)
  });
  const data = await readJson(res);
  if (!res.ok) {
    const err = data.error || {};
    let message = err.error_data?.details || err.message || data.raw || `HTTP ${res.status}`;
    if (err.code === 131047 || /24 hours|re-engagement/i.test(message)) message = 'WhatsApp only allows free-form messages within 24 hours of the employee\'s last reply. Add an approved template for this notification in Integrations → WhatsApp templates.';
    if (err.code === 132001) message = `Template "${msg.template?.name}" does not exist in this language on your WhatsApp Business account. Check the template name and language.`;
    if (err.code === 190) message = 'The WhatsApp access token has expired or is invalid. Generate a permanent System User token in Meta Business Manager.';
    throw new Error(`WhatsApp Cloud API: ${message}`);
  }
  return { providerMessageId: data.messages?.[0]?.id, response: data };
}

async function sendMaytapi(cfg, msg) {
  const base = cfg.maytapi.baseUrl || 'https://api.maytapi.com/api';
  const body = msg.document?.url
    ? { to_number: msg.to, type: 'media', message: msg.document.url, text: String(msg.body || '').slice(0, 1024), filename: msg.document.filename }
    : { to_number: msg.to, type: 'text', message: String(msg.body || '').slice(0, 4096) };
  const res = await fetch(`${base}/${encodeURIComponent(cfg.maytapi.productId)}/${encodeURIComponent(cfg.maytapi.phoneId)}/sendMessage`, {
    method: 'POST',
    headers: { 'x-maytapi-key': cfg.maytapi.token, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify(body)
  });
  const data = await readJson(res);
  if (!res.ok || data.success === false) throw new Error(`Maytapi: ${data.message || data.raw || `HTTP ${res.status}`}`);
  return { providerMessageId: data.data?.msgId || data.data?.id, response: data };
}

async function sendWhatsappVia(cfg, msg) {
  if (!msg.to) throw new Error('Recipient WhatsApp number is missing or not a valid mobile number');
  return cfg.provider === 'MAYTAPI' ? sendMaytapi(cfg, msg) : sendMeta(cfg, msg);
}

module.exports = { sendEmailVia, sendWhatsappVia, cleanTemplateParam };
