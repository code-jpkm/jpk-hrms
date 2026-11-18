const mongoose = require('mongoose');

const leaveGrantSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  leaveType: { type: String, required: true },
  days: { type: Number, required: true },
  grantType: { type: String, enum: ['MANUAL', 'COMP_OFF', 'ADJUSTMENT', 'SPECIAL', 'OPENING_BALANCE', 'AI'], default: 'MANUAL' },
  reason: String,
  referenceDate: Date,
  grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('LeaveGrant', leaveGrantSchema);
