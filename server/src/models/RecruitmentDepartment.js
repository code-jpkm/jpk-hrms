const mongoose = require('mongoose');

const recruitmentDepartmentSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  directorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  description: String,
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

recruitmentDepartmentSchema.index({ tenantId: 1, name: 1 }, { unique: true });
recruitmentDepartmentSchema.index({ tenantId: 1, code: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('RecruitmentDepartment', recruitmentDepartmentSchema);
