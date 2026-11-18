const mongoose = require('mongoose');

const jobOpeningSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  jobId: { type: String, trim: true },
  jobProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentJobProfile' },
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentDepartment' },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentLocation' },
  title: { type: String, required: true, trim: true },
  department: String,
  location: String,
  openings: { type: Number, default: 1 },
  experience: String,
  ctc: String,
  description: String,
  status: { type: String, enum: ['OPEN', 'ON_HOLD', 'CLOSED'], default: 'OPEN' },
  postedAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

jobOpeningSchema.index({ tenantId: 1, jobId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('JobOpening', jobOpeningSchema);
