const mongoose = require('mongoose');

/**
 * One document per tenant holding the email, WhatsApp and AI configuration
 * entered in Company Settings → Integrations. Secret fields end in `Enc` and
 * hold values sealed by utils/secretBox — they are never returned to the
 * browser. Anything left blank here falls back to the server environment
 * (SMTP_*, BREVO_API_KEY, WHATSAPP_*, MAYTAPI_*, GEMINI_*).
 */
const integrationSettingSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },

  email: {
    enabled: { type: Boolean, default: true },
    provider: { type: String, enum: ['SMTP', 'BREVO', 'RESEND', 'SENDGRID'], default: 'SMTP' },
    fromName: String,
    fromEmail: String,
    replyTo: String,
    smtp: {
      host: String,
      port: Number,
      secure: Boolean,
      user: String,
      passEnc: String
    },
    apiKeyEnc: String,
    lastTestAt: Date,
    lastTestOk: Boolean,
    lastTestMessage: String
  },

  whatsapp: {
    enabled: { type: Boolean, default: true },
    provider: { type: String, enum: ['META', 'MAYTAPI'], default: 'META' },
    defaultCountryCode: { type: String, default: '91' },
    meta: {
      phoneNumberId: String,
      businessAccountId: String,
      apiVersion: String,
      accessTokenEnc: String,
      appSecretEnc: String,
      verifyToken: String,
      templateLanguage: String
    },
    maytapi: {
      productId: String,
      phoneId: String,
      tokenEnc: String
    },
    // eventKey → { name, language } for Meta template messages.
    templates: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastTestAt: Date,
    lastTestOk: Boolean,
    lastTestMessage: String
  },

  ai: {
    enabled: { type: Boolean, default: true },
    model: String,
    apiKeyEnc: String,
    allowProviderStorage: { type: Boolean, default: false },
    // featureKey → boolean. Missing keys mean "on".
    features: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastTestAt: Date,
    lastTestOk: Boolean,
    lastTestMessage: String
  },

  // eventKey → { email, whatsapp, inApp } overriding the catalogue defaults.
  events: { type: mongoose.Schema.Types.Mixed, default: {} },

  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('IntegrationSetting', integrationSettingSchema);
