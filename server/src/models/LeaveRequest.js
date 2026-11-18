const mongoose = require('mongoose');

const leaveRequestSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  appliedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  appliedOnBehalf: { type: Boolean, default: false },
  requestType: { type: String, enum: ['LEAVE', 'WFH'], default: 'LEAVE' },
  leaveType: { type: String, default: 'EL' },
  dayPart: { type: String, enum: ['FULL', 'FIRST_HALF', 'SECOND_HALF'], default: 'FULL' },
  fromDate: Date,
  toDate: Date,
  days: { type: Number, default: 1 },
  reason: String,
  approverEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'], default: 'PENDING' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decidedAt: Date,
  decisionRemarks: String
}, { timestamps: true });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
