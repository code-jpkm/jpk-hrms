const mongoose = require('mongoose');

const probationReviewSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  managerEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  dueDate: { type: Date, required: true, index: true },
  status: { type: String, enum: ['PENDING_MANAGER', 'CONFIRMED', 'EXTENDED', 'CLOSED'], default: 'PENDING_MANAGER' },
  extensionMonths: { type: Number, default: 0 },
  extendedUntil: Date,
  managerRemarks: String,
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
  remindersSent: { type: Number, default: 0 },
  lastReminderAt: Date
}, { timestamps: true });

probationReviewSchema.index({ tenantId: 1, employeeId: 1, dueDate: 1 }, { unique: true });
module.exports = mongoose.model('ProbationReview', probationReviewSchema);
