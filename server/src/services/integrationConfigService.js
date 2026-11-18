/**
 * Effective email / WhatsApp / AI configuration for a tenant.
 *
 * Order of precedence for every field: value saved in Company Settings →
 * Integrations, then the server environment, then a safe default. The
 * browser only ever receives `publicView()` — secrets are masked.
 */
const IntegrationSetting = require('../models/IntegrationSetting');
const { seal, open, mask } = require('../utils/secretBox');
const { eventDefaults, EVENT_KEYS, EVENTS } = require('./messaging/events');

const CACHE_MS = 30 * 1000;
const cache = new Map();

const AI_FEATURES = {
  BRIEFING: 'Daily briefing on the home page',
  ASSISTANT: 'HR chat assistant answers',
  COMMANDS: 'Natural-language HR commands',
  RECRUITMENT: 'Job descriptions, screening and interview questions',
  NOTICES: 'Notice drafting and translation',
  LEAVE: 'Leave approval insights',
  PAYROLL: 'Payroll review and payslip explanations',
  ATTENDANCE: 'Attendance insights',
  PROBATION: 'Probation review drafts',
  DOCUMENTS: 'Letter and document drafting',
  MESSAGES: 'Personalised wishes and messages'
};

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : v;
}

function parseFrom(value) {
  // "JPK HR <hr@jpk.in>" → { name, email }
  const s = String(value || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: '', email: s };
}

function envEmail() {
  const provider = env('EMAIL_PROVIDER', env('BREVO_API_KEY') ? 'BREVO' : env('RESEND_API_KEY') ? 'RESEND' : env('SENDGRID_API_KEY') ? 'SENDGRID' : 'SMTP').toUpperCase();
  const from = parseFrom(env('EMAIL_FROM', env('SMTP_FROM')));
  return {
    provider,
    fromName: env('EMAIL_FROM_NAME', from.name),
    fromEmail: from.email,
    replyTo: env('EMAIL_REPLY_TO'),
    smtp: {
      host: env('SMTP_HOST'),
      port: Number(env('SMTP_PORT', '587')),
      secure: env('SMTP_SECURE') ? env('SMTP_SECURE') === 'true' : Number(env('SMTP_PORT', '587')) === 465,
      user: env('SMTP_USER'),
      pass: env('SMTP_PASS')
    },
    apiKey: env('EMAIL_API_KEY', provider === 'BREVO' ? env('BREVO_API_KEY') : provider === 'RESEND' ? env('RESEND_API_KEY') : provider === 'SENDGRID' ? env('SENDGRID_API_KEY') : '')
  };
}

function envWhatsapp() {
  const hasMeta = Boolean(env('WHATSAPP_ACCESS_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID'));
  const hasMaytapi = Boolean(env('MAYTAPI_TOKEN') && env('MAYTAPI_PRODUCT_ID') && env('MAYTAPI_PHONE_ID'));
  return {
    provider: env('WHATSAPP_PROVIDER', hasMeta ? 'META' : hasMaytapi ? 'MAYTAPI' : 'META').toUpperCase(),
    defaultCountryCode: env('WHATSAPP_DEFAULT_COUNTRY_CODE', '91'),
    meta: {
      phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
      businessAccountId: env('WHATSAPP_BUSINESS_ACCOUNT_ID'),
      apiVersion: env('WHATSAPP_API_VERSION', 'v26.0'),
      accessToken: env('WHATSAPP_ACCESS_TOKEN'),
      appSecret: env('WHATSAPP_APP_SECRET'),
      verifyToken: env('WHATSAPP_VERIFY_TOKEN'),
      templateLanguage: env('WHATSAPP_TEMPLATE_LANGUAGE', 'en')
    },
    maytapi: {
      baseUrl: env('MAYTAPI_BASE_URL', 'https://api.maytapi.com/api'),
      productId: env('MAYTAPI_PRODUCT_ID'),
      phoneId: env('MAYTAPI_PHONE_ID'),
      token: env('MAYTAPI_TOKEN')
    }
  };
}

function envAi() {
  return {
    apiKey: env('GEMINI_API_KEY'),
    model: env('GEMINI_MODEL', 'gemini-flash-latest'),
    timeoutMs: Number(env('GEMINI_TIMEOUT_MS', '25000')),
    baseUrl: env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    allowProviderStorage: env('GEMINI_ALLOW_STORAGE') === 'true'
  };
}

function pick(saved, fallback) {
  return saved === undefined || saved === null || saved === '' ? fallback : saved;
}

function emailConfigured(c) {
  if (!c.fromEmail && c.provider !== 'SMTP') return false;
  if (c.provider === 'SMTP') return Boolean(c.smtp.host && (c.fromEmail || c.smtp.user));
  return Boolean(c.apiKey && c.fromEmail);
}

function whatsappConfigured(c) {
  if (c.provider === 'MAYTAPI') return Boolean(c.maytapi.productId && c.maytapi.phoneId && c.maytapi.token);
  return Boolean(c.meta.phoneNumberId && c.meta.accessToken);
}

function build(doc) {
  const d = doc || {};
  const e = envEmail();
  const w = envWhatsapp();
  const a = envAi();
  const se = d.email || {};
  const sw = d.whatsapp || {};
  const sa = d.ai || {};

  const email = {
    enabled: se.enabled !== false,
    provider: pick(se.provider, e.provider),
    fromName: pick(se.fromName, e.fromName),
    fromEmail: pick(se.fromEmail, e.fromEmail),
    replyTo: pick(se.replyTo, e.replyTo),
    smtp: {
      host: pick(se.smtp?.host, e.smtp.host),
      port: Number(pick(se.smtp?.port, e.smtp.port)) || 587,
      secure: se.smtp?.secure !== undefined && se.smtp?.secure !== null ? Boolean(se.smtp.secure) : e.smtp.secure,
      user: pick(se.smtp?.user, e.smtp.user),
      pass: pick(open(se.smtp?.passEnc), e.smtp.pass)
    },
    apiKey: pick(open(se.apiKeyEnc), e.apiKey),
    source: se.provider ? 'settings' : 'environment'
  };
  email.configured = emailConfigured(email);

  const whatsapp = {
    enabled: sw.enabled !== false,
    provider: pick(sw.provider, w.provider),
    defaultCountryCode: pick(sw.defaultCountryCode, w.defaultCountryCode),
    meta: {
      phoneNumberId: pick(sw.meta?.phoneNumberId, w.meta.phoneNumberId),
      businessAccountId: pick(sw.meta?.businessAccountId, w.meta.businessAccountId),
      apiVersion: pick(sw.meta?.apiVersion, w.meta.apiVersion),
      accessToken: pick(open(sw.meta?.accessTokenEnc), w.meta.accessToken),
      appSecret: pick(open(sw.meta?.appSecretEnc), w.meta.appSecret),
      verifyToken: pick(sw.meta?.verifyToken, w.meta.verifyToken),
      templateLanguage: pick(sw.meta?.templateLanguage, w.meta.templateLanguage)
    },
    maytapi: {
      baseUrl: w.maytapi.baseUrl,
      productId: pick(sw.maytapi?.productId, w.maytapi.productId),
      phoneId: pick(sw.maytapi?.phoneId, w.maytapi.phoneId),
      token: pick(open(sw.maytapi?.tokenEnc), w.maytapi.token)
    },
    templates: sw.templates || {},
    source: sw.provider ? 'settings' : 'environment'
  };
  whatsapp.configured = whatsappConfigured(whatsapp);

  const features = Object.fromEntries(Object.keys(AI_FEATURES).map((k) => [k, (sa.features || {})[k] !== false]));
  const ai = {
    enabled: sa.enabled !== false,
    apiKey: pick(open(sa.apiKeyEnc), a.apiKey),
    model: pick(sa.model, a.model),
    timeoutMs: a.timeoutMs,
    baseUrl: a.baseUrl,
    allowProviderStorage: sa.allowProviderStorage === true || (sa.allowProviderStorage === undefined && a.allowProviderStorage),
    features,
    source: sa.apiKeyEnc ? 'settings' : 'environment'
  };
  ai.configured = Boolean(ai.apiKey);

  const defaults = eventDefaults();
  const events = {};
  for (const key of EVENT_KEYS) events[key] = { ...defaults[key], ...((d.events || {})[key] || {}) };

  return { email, whatsapp, ai, events };
}

async function getConfig(tenantId) {
  const key = String(tenantId || 'global');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const doc = tenantId ? await IntegrationSetting.findOne({ tenantId }).lean() : null;
  const value = build(doc);
  cache.set(key, { at: Date.now(), value });
  return value;
}

function invalidate(tenantId) {
  cache.delete(String(tenantId || 'global'));
}

function publicView(config, doc) {
  const d = doc || {};
  return {
    email: {
      enabled: config.email.enabled,
      provider: config.email.provider,
      configured: config.email.configured,
      fromName: config.email.fromName,
      fromEmail: config.email.fromEmail,
      replyTo: config.email.replyTo,
      smtp: { host: config.email.smtp.host, port: config.email.smtp.port, secure: config.email.smtp.secure, user: config.email.smtp.user, passMasked: mask(config.email.smtp.pass) },
      apiKeyMasked: mask(config.email.apiKey),
      source: config.email.source,
      lastTest: d.email?.lastTestAt ? { at: d.email.lastTestAt, ok: d.email.lastTestOk, message: d.email.lastTestMessage } : null
    },
    whatsapp: {
      enabled: config.whatsapp.enabled,
      provider: config.whatsapp.provider,
      configured: config.whatsapp.configured,
      defaultCountryCode: config.whatsapp.defaultCountryCode,
      meta: {
        phoneNumberId: config.whatsapp.meta.phoneNumberId,
        businessAccountId: config.whatsapp.meta.businessAccountId,
        apiVersion: config.whatsapp.meta.apiVersion,
        accessTokenMasked: mask(config.whatsapp.meta.accessToken),
        appSecretMasked: mask(config.whatsapp.meta.appSecret),
        verifyToken: config.whatsapp.meta.verifyToken,
        templateLanguage: config.whatsapp.meta.templateLanguage
      },
      maytapi: { productId: config.whatsapp.maytapi.productId, phoneId: config.whatsapp.maytapi.phoneId, tokenMasked: mask(config.whatsapp.maytapi.token) },
      templates: config.whatsapp.templates,
      source: config.whatsapp.source,
      lastTest: d.whatsapp?.lastTestAt ? { at: d.whatsapp.lastTestAt, ok: d.whatsapp.lastTestOk, message: d.whatsapp.lastTestMessage } : null
    },
    ai: {
      enabled: config.ai.enabled,
      configured: config.ai.configured,
      model: config.ai.model,
      apiKeyMasked: mask(config.ai.apiKey),
      allowProviderStorage: config.ai.allowProviderStorage,
      features: config.ai.features,
      featureLabels: AI_FEATURES,
      source: config.ai.source,
      lastTest: d.ai?.lastTestAt ? { at: d.ai.lastTestAt, ok: d.ai.lastTestOk, message: d.ai.lastTestMessage } : null
    },
    events: config.events
  };
}

const MASK_RE = /^•+/;
function isNewSecret(v) {
  return typeof v === 'string' && v.trim() !== '' && !MASK_RE.test(v.trim());
}

function str(v, max = 300) {
  if (v === undefined || v === null) return undefined;
  return String(v).trim().slice(0, max);
}

/** Apply a validated partial update for one section. Returns the saved doc. */
async function saveSection(tenantId, section, payload = {}, userId) {
  const doc = (await IntegrationSetting.findOne({ tenantId })) || new IntegrationSetting({ tenantId });
  const p = payload || {};

  if (section === 'email') {
    const provider = String(p.provider || doc.email?.provider || 'SMTP').toUpperCase();
    if (!['SMTP', 'BREVO', 'RESEND', 'SENDGRID'].includes(provider)) throw Object.assign(new Error('Unsupported email provider'), { status: 400 });
    if (p.fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.fromEmail).trim())) throw Object.assign(new Error('Sender email address is not valid'), { status: 400 });
    doc.email = doc.email || {};
    doc.email.enabled = p.enabled !== false;
    doc.email.provider = provider;
    if (p.fromName !== undefined) doc.email.fromName = str(p.fromName, 120);
    if (p.fromEmail !== undefined) doc.email.fromEmail = str(p.fromEmail, 200);
    if (p.replyTo !== undefined) doc.email.replyTo = str(p.replyTo, 200);
    doc.email.smtp = doc.email.smtp || {};
    if (p.smtp) {
      if (p.smtp.host !== undefined) doc.email.smtp.host = str(p.smtp.host, 200);
      if (p.smtp.port !== undefined) {
        const port = Number(p.smtp.port);
        if (p.smtp.port !== '' && (!Number.isInteger(port) || port < 1 || port > 65535)) throw Object.assign(new Error('SMTP port must be a number between 1 and 65535'), { status: 400 });
        doc.email.smtp.port = p.smtp.port === '' ? undefined : port;
      }
      if (p.smtp.secure !== undefined) doc.email.smtp.secure = Boolean(p.smtp.secure);
      if (p.smtp.user !== undefined) doc.email.smtp.user = str(p.smtp.user, 200);
      if (isNewSecret(p.smtp.pass)) doc.email.smtp.passEnc = seal(p.smtp.pass.trim());
      if (p.smtp.clearPass) doc.email.smtp.passEnc = '';
    }
    if (isNewSecret(p.apiKey)) doc.email.apiKeyEnc = seal(p.apiKey.trim());
    if (p.clearApiKey) doc.email.apiKeyEnc = '';
    doc.markModified('email');
  } else if (section === 'whatsapp') {
    const provider = String(p.provider || doc.whatsapp?.provider || 'META').toUpperCase();
    if (!['META', 'MAYTAPI'].includes(provider)) throw Object.assign(new Error('Unsupported WhatsApp provider'), { status: 400 });
    doc.whatsapp = doc.whatsapp || {};
    doc.whatsapp.enabled = p.enabled !== false;
    doc.whatsapp.provider = provider;
    if (p.defaultCountryCode !== undefined) doc.whatsapp.defaultCountryCode = String(p.defaultCountryCode).replace(/\D/g, '').slice(0, 4) || '91';
    doc.whatsapp.meta = doc.whatsapp.meta || {};
    if (p.meta) {
      for (const f of ['phoneNumberId', 'businessAccountId', 'verifyToken', 'templateLanguage']) if (p.meta[f] !== undefined) doc.whatsapp.meta[f] = str(p.meta[f], 200);
      if (p.meta.apiVersion !== undefined) {
        const v = String(p.meta.apiVersion || '').trim();
        if (v && !/^v\d{2}\.\d$/.test(v)) throw Object.assign(new Error('Graph API version looks like v26.0'), { status: 400 });
        doc.whatsapp.meta.apiVersion = v || undefined;
      }
      if (isNewSecret(p.meta.accessToken)) doc.whatsapp.meta.accessTokenEnc = seal(p.meta.accessToken.trim());
      if (p.meta.clearAccessToken) doc.whatsapp.meta.accessTokenEnc = '';
      if (isNewSecret(p.meta.appSecret)) doc.whatsapp.meta.appSecretEnc = seal(p.meta.appSecret.trim());
    }
    doc.whatsapp.maytapi = doc.whatsapp.maytapi || {};
    if (p.maytapi) {
      if (p.maytapi.productId !== undefined) doc.whatsapp.maytapi.productId = str(p.maytapi.productId, 120);
      if (p.maytapi.phoneId !== undefined) doc.whatsapp.maytapi.phoneId = str(p.maytapi.phoneId, 60);
      if (isNewSecret(p.maytapi.token)) doc.whatsapp.maytapi.tokenEnc = seal(p.maytapi.token.trim());
      if (p.maytapi.clearToken) doc.whatsapp.maytapi.tokenEnc = '';
    }
    if (p.templates && typeof p.templates === 'object') {
      const clean = {};
      for (const key of EVENT_KEYS) {
        const t = p.templates[key];
        if (!t) continue;
        const name = String(t.name || '').trim().toLowerCase();
        if (name && !/^[a-z0-9_]{1,512}$/.test(name)) throw Object.assign(new Error(`Template name for ${EVENTS[key].label} can only use lowercase letters, numbers and _`), { status: 400 });
        clean[key] = { name, language: String(t.language || '').trim().slice(0, 12) };
      }
      doc.whatsapp.templates = clean;
    }
    doc.markModified('whatsapp');
  } else if (section === 'ai') {
    doc.ai = doc.ai || {};
    doc.ai.enabled = p.enabled !== false;
    if (p.model !== undefined) {
      const m = String(p.model || '').trim();
      if (m && !/^[a-z0-9.\-]{3,80}$/i.test(m)) throw Object.assign(new Error('Model id looks like gemini-flash-latest'), { status: 400 });
      doc.ai.model = m || undefined;
    }
    if (isNewSecret(p.apiKey)) doc.ai.apiKeyEnc = seal(p.apiKey.trim());
    if (p.clearApiKey) doc.ai.apiKeyEnc = '';
    if (p.allowProviderStorage !== undefined) doc.ai.allowProviderStorage = Boolean(p.allowProviderStorage);
    if (p.features && typeof p.features === 'object') {
      doc.ai.features = Object.fromEntries(Object.keys(AI_FEATURES).map((k) => [k, p.features[k] !== false]));
    }
    doc.markModified('ai');
  } else if (section === 'events') {
    const clean = {};
    for (const key of EVENT_KEYS) {
      const row = (p.events || p)[key];
      if (!row) continue;
      clean[key] = { email: Boolean(row.email), whatsapp: Boolean(row.whatsapp), inApp: row.inApp !== false };
    }
    doc.events = clean;
    doc.markModified('events');
  } else {
    throw Object.assign(new Error('Unknown settings section'), { status: 400 });
  }

  doc.updatedBy = userId;
  await doc.save();
  invalidate(tenantId);
  return doc;
}

async function recordTest(tenantId, section, ok, message) {
  await IntegrationSetting.updateOne(
    { tenantId },
    { $set: { [`${section}.lastTestAt`]: new Date(), [`${section}.lastTestOk`]: ok, [`${section}.lastTestMessage`]: String(message || '').slice(0, 400) }, $setOnInsert: { tenantId } },
    { upsert: true }
  );
}

module.exports = { getConfig, invalidate, publicView, saveSection, recordTest, AI_FEATURES };
