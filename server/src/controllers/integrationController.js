/**
 * Company Settings → Integrations: email, WhatsApp and Gemini configuration,
 * notification rules, test sends, delivery log, plus the Meta webhook that
 * reports delivered/read receipts.
 */
const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const IntegrationSetting = require('../models/IntegrationSetting');
const NotificationLog = require('../models/NotificationLog');
const AiUsage = require('../models/AiUsage');
const Tenant = require('../models/Tenant');
const RuleAudit = require('../models/RuleAudit');
const { getConfig, publicView, saveSection, recordTest, invalidate } = require('../services/integrationConfigService');
const { publicCatalogue } = require('../services/messaging/events');
const { renderEmail, renderText } = require('../services/messaging/emailLayout');
const { normalizeWhatsappNumber } = require('../services/messaging/phone');
const { enqueue, sendNow, retry, maskForDisplay } = require('../services/messaging/outbox');
const { generate, AiUnavailableError } = require('../services/ai/geminiClient');

async function view(tenantId) {
  invalidate(tenantId);
  const [config, doc, tenant] = await Promise.all([
    getConfig(tenantId),
    IntegrationSetting.findOne({ tenantId }).lean(),
    Tenant.findById(tenantId).select('name').lean()
  ]);
  const webhookBase = String(process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
  return {
    ...publicView(config, doc),
    catalogue: publicCatalogue(tenant?.name || 'JPK'),
    webhookUrl: webhookBase ? `${webhookBase}/api/integrations/whatsapp/webhook/${tenantId}` : null
  };
}

exports.get = asyncHandler(async (req, res) => {
  res.json(await view(req.tenantId));
});

exports.save = asyncHandler(async (req, res) => {
  const section = String(req.params.section || '').toLowerCase();
  try {
    await saveSection(req.tenantId, section, req.body || {}, req.user._id);
  } catch (error) {
    if (error.status) throw new ApiError(error.status, error.message);
    throw error;
  }
  await RuleAudit.create({
    tenantId: req.tenantId,
    module: 'COMPANY_SETTINGS',
    action: `SAVE_INTEGRATION_${section.toUpperCase()}`,
    targetId: String(req.tenantId),
    // Never write secrets to the audit trail.
    after: { section, keys: Object.keys(req.body || {}) },
    reason: 'Updated integration settings',
    changedBy: req.user._id
  }).catch(() => {});
  res.json({ ...(await view(req.tenantId)), message: 'Settings saved' });
});

exports.testEmail = asyncHandler(async (req, res) => {
  const to = String(req.body?.to || req.user.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ApiError(400, 'Enter a valid email address to send the test to');
  const tenant = await Tenant.findById(req.tenantId).select('name').lean();
  const company = tenant?.name || 'JPK HRMS';
  const content = {
    heading: 'Email is connected',
    intro: `This test confirms that ${company} HRMS can send email. Leave approvals, payslips, birthday wishes and notices will now reach employees' inboxes.`,
    rows: [['Sent by', req.user.name || req.user.email], ['Sent at', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })]]
  };
  const log = await enqueue({ tenantId: req.tenantId, channel: 'EMAIL', event: 'TEST', to, recipientName: req.user.name, subject: `Test email from ${company} HRMS`, body: renderText(content), html: renderEmail({ company, ...content, tone: 'positive' }), createdBy: req.user._id, maxAttempts: 1 });
  const result = await sendNow(log._id);
  const ok = result?.status === 'SENT';
  await recordTest(req.tenantId, 'email', ok, ok ? `Delivered to ${to}` : result?.error);
  res.status(ok ? 200 : 422).json({ ok, status: result?.status, message: ok ? `Test email sent to ${to}` : (result?.error || 'Email could not be sent') });
});

exports.testWhatsapp = asyncHandler(async (req, res) => {
  const config = await getConfig(req.tenantId);
  const to = normalizeWhatsappNumber(req.body?.to || req.user.phone, config.whatsapp.defaultCountryCode);
  if (!to) throw new ApiError(400, 'Enter a valid mobile number, for example 98300 12345');
  const tenant = await Tenant.findById(req.tenantId).select('name').lean();
  // Meta needs a template for a business-initiated first message. The
  // pre-approved "hello_world" template exists on every new WhatsApp Business account.
  const useTemplate = config.whatsapp.provider === 'META' && req.body?.mode !== 'text';
  const templateName = String(req.body?.template || 'hello_world').trim();
  const log = await enqueue({
    tenantId: req.tenantId,
    channel: 'WHATSAPP',
    event: 'TEST',
    to,
    recipientName: req.user.name,
    body: `✅ WhatsApp is connected to ${tenant?.name || 'JPK'} HRMS. Employees will receive leave updates, payslip alerts and wishes here.`,
    template: useTemplate ? { name: templateName, language: templateName === 'hello_world' ? 'en_US' : (config.whatsapp.meta.templateLanguage || 'en'), params: [] } : undefined,
    createdBy: req.user._id,
    maxAttempts: 1
  });
  const result = await sendNow(log._id);
  const ok = result?.status === 'SENT';
  await recordTest(req.tenantId, 'whatsapp', ok, ok ? `Sent to +${to}` : result?.error);
  res.status(ok ? 200 : 422).json({ ok, status: result?.status, message: ok ? `Test message sent to +${to}` : (result?.error || 'WhatsApp message could not be sent') });
});

exports.testAi = asyncHandler(async (req, res) => {
  try {
    const out = await generate({ tenantId: req.tenantId, userId: req.user._id, feature: null, prompt: 'Reply with exactly: Gemini is connected.', maxOutputTokens: 512, timeoutMs: 20000 });
    await recordTest(req.tenantId, 'ai', true, `${out.model}: ${out.text.slice(0, 80)}`);
    res.json({ ok: true, model: out.model, message: `Gemini replied using ${out.model}` });
  } catch (error) {
    const message = error instanceof AiUnavailableError ? error.message : `Gemini test failed: ${error.message}`;
    await recordTest(req.tenantId, 'ai', false, message);
    res.status(422).json({ ok: false, message });
  }
});

exports.logs = asyncHandler(async (req, res) => {
  const q = { tenantId: req.tenantId };
  if (req.query.channel && ['EMAIL', 'WHATSAPP'].includes(String(req.query.channel).toUpperCase())) q.channel = String(req.query.channel).toUpperCase();
  if (req.query.status) q.status = { $in: String(req.query.status).toUpperCase().split(',') };
  if (req.query.event) q.event = String(req.query.event).toUpperCase();
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60), 'i');
    q.$or = [{ to: rx }, { recipientName: rx }, { subject: rx }];
  }
  const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 40));
  const page = Math.max(1, Number(req.query.page) || 1);
  const [rows, total, stats] = await Promise.all([
    NotificationLog.find(q).sort('-createdAt').skip((page - 1) * limit).limit(limit).select('-html -attachments.contentBase64 -providerResponse').lean(),
    NotificationLog.countDocuments(q),
    NotificationLog.aggregate([
      { $match: { tenantId: req.tenantId, createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
      { $group: { _id: { channel: '$channel', status: '$status' }, n: { $sum: 1 } } }
    ])
  ]);
  res.json({ rows: rows.map(maskForDisplay), total, page, limit, stats: stats.map((s) => ({ channel: s._id.channel, status: s._id.status, count: s.n })) });
});

exports.logDetail = asyncHandler(async (req, res) => {
  const row = await NotificationLog.findOne({ _id: req.params.id, tenantId: req.tenantId }).select('-attachments.contentBase64').lean();
  if (!row) throw new ApiError(404, 'Message not found');
  res.json({ row: maskForDisplay(row) });
});

exports.retryLog = asyncHandler(async (req, res) => {
  const row = await retry(req.params.id, req.tenantId);
  if (!row) throw new ApiError(400, 'Only failed or skipped messages can be retried');
  res.json({ row, message: row.status === 'SENT' ? 'Message sent' : `Message ${String(row.status).toLowerCase()}: ${row.error || ''}`.trim() });
});

exports.aiUsage = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);
  const [byFeature, recent] = await Promise.all([
    AiUsage.aggregate([
      { $match: { tenantId: req.tenantId, createdAt: { $gte: since } } },
      { $group: { _id: '$feature', calls: { $sum: 1 }, failures: { $sum: { $cond: ['$ok', 0, 1] } }, avgMs: { $avg: '$ms' } } },
      { $sort: { calls: -1 } }
    ]),
    AiUsage.find({ tenantId: req.tenantId }).sort('-createdAt').limit(25).lean()
  ]);
  res.json({ byFeature: byFeature.map((x) => ({ feature: x._id || 'GENERAL', calls: x.calls, failures: x.failures, avgMs: Math.round(x.avgMs || 0) })), recent });
});

/* ---------------- Meta WhatsApp webhook (public) ---------------- */

exports.webhookVerify = asyncHandler(async (req, res) => {
  const config = await getConfig(req.params.tenantId);
  const token = config.whatsapp.meta.verifyToken;
  if (req.query['hub.mode'] === 'subscribe' && token && req.query['hub.verify_token'] === token) {
    return res.status(200).send(String(req.query['hub.challenge'] || ''));
  }
  return res.sendStatus(403);
});

exports.webhookReceive = asyncHandler(async (req, res) => {
  const config = await getConfig(req.params.tenantId);
  const secret = config.whatsapp.meta.appSecret;
  if (secret) {
    const signature = String(req.headers['x-hub-signature-256'] || '');
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex')}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  }
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      for (const s of change.value?.statuses || []) {
        const patch = {};
        if (s.status === 'delivered') Object.assign(patch, { status: 'DELIVERED', deliveredAt: new Date(Number(s.timestamp) * 1000 || Date.now()) });
        else if (s.status === 'read') Object.assign(patch, { status: 'READ', readAt: new Date(Number(s.timestamp) * 1000 || Date.now()) });
        else if (s.status === 'failed') Object.assign(patch, { status: 'FAILED', error: s.errors?.[0]?.error_data?.details || s.errors?.[0]?.message || s.errors?.[0]?.title || 'Delivery failed' });
        if (Object.keys(patch).length) {
          // Never move a READ receipt back to DELIVERED when webhooks arrive out of order.
          const guard = patch.status === 'DELIVERED' ? { status: { $nin: ['READ'] } } : {};
          await NotificationLog.updateOne({ tenantId: req.params.tenantId, providerMessageId: s.id, ...guard }, { $set: patch });
        }
      }
    }
  }
  res.sendStatus(200);
});
