const mongoose = require('mongoose');

const shiftAssignmentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  fromDate: Date,
  toDate: Date,
  // Days of the week this row applies on (0 = Sunday … 6 = Saturday), for
  // patterns such as "Mon–Fri one shift, Saturday another". Not set = every day.
  // Stored sorted, never empty.
  weekdays: { type: [Number], default: undefined },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('ShiftAssignment', shiftAssignmentSchema);
