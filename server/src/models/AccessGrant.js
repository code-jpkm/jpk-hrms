const mongoose = require('mongoose');

const accessGrantSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  viewerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  resource: { type: String, enum: ['ATTENDANCE', 'SALARY', 'EMPLOYEE_PROFILE', 'LEAVE'], required: true },
  canViewAll: { type: Boolean, default: false },
  workLocations: [{ type: String, enum: ['OFFICE', 'FACTORY'] }],
  employeeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  notes: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

accessGrantSchema.index({ tenantId: 1, viewerUserId: 1, resource: 1 }, { unique: true });

module.exports = mongoose.model('AccessGrant', accessGrantSchema);
