const mongoose = require('mongoose');

const recruitmentJobProfileSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, trim: true, uppercase: true },
  title: { type: String, required: true, trim: true },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentDepartment' },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentLocation' },
  designation: String,
  department: String,
  location: String,
  experience: String,
  ctc: String,
  employmentType: { type: String, default: 'FRESHER' },
  defaultRole: { type: String, enum: ['EMPLOYEE', 'MANAGER', 'HR_ADMIN'], default: 'EMPLOYEE' },
  defaultReportingTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  isManagerProfile: { type: Boolean, default: false },
  defaultPermissions: [{
    module: { type: String, uppercase: true, trim: true },
    actions: [{ type: String, uppercase: true, trim: true }]
  }],
  description: String,
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

recruitmentJobProfileSchema.index({ tenantId: 1, title: 1, departmentId: 1 }, { unique: true, sparse: true });
recruitmentJobProfileSchema.index({ tenantId: 1, code: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('RecruitmentJobProfile', recruitmentJobProfileSchema);
