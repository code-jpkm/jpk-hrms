const asyncHandler = require('../utils/asyncHandler');
const NotificationLog = require('../models/NotificationLog');
const InAppNotification = require('../models/InAppNotification');
const { maskForDisplay } = require('../services/messaging/outbox');

exports.logs = asyncHandler(async (req, res) => {
  const logs = await NotificationLog.find({ tenantId: req.tenantId }).sort('-createdAt').limit(100).lean();
  res.json({ logs: logs.map(maskForDisplay) });
});

exports.inbox = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
  const notifications = await InAppNotification.find({ tenantId: req.tenantId, recipientUserId: req.user._id }).sort('-createdAt').limit(limit);
  const unreadCount = await InAppNotification.countDocuments({ tenantId: req.tenantId, recipientUserId: req.user._id, readAt: { $exists: false } });
  res.json({ notifications, unreadCount });
});

exports.markRead = asyncHandler(async (req, res) => {
  const notification = await InAppNotification.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenantId, recipientUserId: req.user._id },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  res.json({ notification, message: 'Notification marked as read' });
});

exports.markAllRead = asyncHandler(async (req, res) => {
  const result = await InAppNotification.updateMany(
    { tenantId: req.tenantId, recipientUserId: req.user._id, readAt: { $exists: false } },
    { $set: { readAt: new Date() } }
  );
  res.json({ updated: result.modifiedCount || 0, message: 'All notifications marked as read' });
});
