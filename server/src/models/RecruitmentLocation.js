const mongoose = require('mongoose');

const recruitmentLocationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code: { type: String, trim: true, uppercase: true },
  name: { type: String, required: true, trim: true },
  address: String,
  city: String,
  state: String,
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

recruitmentLocationSchema.index({ tenantId: 1, name: 1 }, { unique: true });
recruitmentLocationSchema.index({ tenantId: 1, code: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('RecruitmentLocation', recruitmentLocationSchema);
