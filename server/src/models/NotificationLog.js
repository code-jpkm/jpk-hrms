const mongoose = require('mongoose');

/**
 * Every email / WhatsApp message the HRMS sends, from the moment it is queued
 * until the provider confirms it. The outbox worker (services/messaging/outbox)
 * claims QUEUED rows, sends them and records the outcome, so a slow SMTP
 * server never blocks an approval click and a failed send can be retried.
 */
const attachmentSchema = new mongoose.Schema({
  filename: String,
  contentType: String,
  // Base64 content is kept only until the message is finished, then cleared.
  contentBase64: String,
  url: String
}, { _id: false });

const notificationLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
  channel: { type: String, enum: ['EMAIL', 'WHATSAPP'], required: true },
  event: { type: String, default: 'CUSTOM', index: true },
  to: String,
  recipientName: String,
  recipientEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subject: String,
  body: String,
  html: String,
  template: {
    name: String,
    language: String,
    params: [String]
  },
  attachments: [attachmentSchema],
  provider: String,
  status: {
    type: String,
    enum: ['QUEUED', 'SENDING', 'PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED'],
    default: 'QUEUED',
    index: true
  },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockedAt: Date,
  sentAt: Date,
  deliveredAt: Date,
  readAt: Date,
  providerMessageId: { type: String, index: true },
  providerResponse: mongoose.Schema.Types.Mixed,
  error: String,
  // Prevents the same event from messaging the same person twice
  // (e.g. a cron job that runs on two instances).
  dedupeKey: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  meta: mongoose.Schema.Types.Mixed
}, { timestamps: true });

notificationLogSchema.index({ status: 1, nextAttemptAt: 1 });
notificationLogSchema.index({ tenantId: 1, createdAt: -1 });
notificationLogSchema.index(
  { tenantId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
