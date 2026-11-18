const mongoose = require('mongoose');

const inAppNotificationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, default: 'GENERAL', index: true },
  title: { type: String, required: true },
  body: String,
  link: String,
  entityType: String,
  entityId: String,
  priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH'], default: 'NORMAL' },
  readAt: Date,
  deliveredAt: Date,
  data: mongoose.Schema.Types.Mixed
}, { timestamps: true });

inAppNotificationSchema.index({ tenantId: 1, recipientUserId: 1, createdAt: -1 });
inAppNotificationSchema.index({ tenantId: 1, recipientUserId: 1, readAt: 1 });

module.exports = mongoose.model('InAppNotification', inAppNotificationSchema);
