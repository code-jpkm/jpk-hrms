const mongoose = require('mongoose');

const leaveBalanceSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  leaveType: { type: String, required: true },
  accrued: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
  manualAdjusted: { type: Number, default: 0 },
  carriedForward: { type: Number, default: 0 },
  lastAccruedForMonth: String
}, { timestamps: true });

leaveBalanceSchema.index({ tenantId: 1, employeeId: 1, leaveType: 1 }, { unique: true });
leaveBalanceSchema.virtual('available').get(function available() {
  return Number(this.accrued || 0) + Number(this.manualAdjusted || 0) + Number(this.carriedForward || 0) - Number(this.used || 0);
});
leaveBalanceSchema.set('toJSON', { virtuals: true });
leaveBalanceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('LeaveBalance', leaveBalanceSchema);
