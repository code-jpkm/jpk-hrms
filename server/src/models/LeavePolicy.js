const mongoose = require('mongoose');

const leavePolicySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  leaveType: { type: String, required: true },
  monthlyAccrual: { type: Number, default: 0 },
  yearlyLimit: { type: Number, default: 0 },
  carryForward: { type: Boolean, default: true },
  requiresApproval: { type: Boolean, default: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });

leavePolicySchema.index({ tenantId: 1, leaveType: 1 }, { unique: true });
module.exports = mongoose.model('LeavePolicy', leavePolicySchema);
