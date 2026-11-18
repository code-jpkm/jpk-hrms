const mongoose = require('mongoose');

const permissionRequestSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  appliedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  appliedOnBehalf: { type: Boolean, default: false },
  type: { type: String, enum: ['LATE_IN', 'EARLY_LEAVE', 'MEDICAL', 'SPECIAL'], required: true },
  date: { type: Date, required: true, index: true },
  requestedMinutes: { type: Number, default: 0 },
  reason: String,
  attachmentUrl: String,
  approverEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
  decisionRemarks: String,
  hrOverride: { type: Boolean, default: false },
  countedInMonthlyLimit: { type: Boolean, default: true }
}, { timestamps: true });

permissionRequestSchema.index({ tenantId: 1, employeeId: 1, type: 1, date: 1 });
module.exports = mongoose.model('PermissionRequest', permissionRequestSchema);
