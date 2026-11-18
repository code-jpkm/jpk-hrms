const mongoose = require('mongoose');

const regularizationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  appliedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  appliedOnBehalf: { type: Boolean, default: false },
  requestType: { type: String, enum: ['ATTENDANCE_CORRECTION', 'LATE_IN', 'EARLY_LEAVE', 'MEDICAL', 'SPECIAL'], default: 'ATTENDANCE_CORRECTION' },
  requestedMinutes: { type: Number, default: 0 },
  attachmentUrl: String,
  date: Date,
  requestedCheckIn: Date,
  requestedCheckOut: Date,
  reason: String,
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
  decisionRemarks: String
}, { timestamps: true });

module.exports = mongoose.model('Regularization', regularizationSchema);
