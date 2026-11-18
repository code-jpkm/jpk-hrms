const mongoose = require('mongoose');

const shiftAssignmentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  fromDate: Date,
  toDate: Date,
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('ShiftAssignment', shiftAssignmentSchema);
