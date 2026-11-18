const mongoose = require('mongoose');

const documentAssetSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  ownerType: { type: String, enum: ['EMPLOYEE', 'CANDIDATE'], required: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true },
  candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', index: true },
  type: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  fileName: { type: String, required: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  sizeBytes: { type: Number, default: 0 },
  dataUrl: String,
  url: String,
  cloudinaryPublicId: String,
  // image | raw | video, as reported by Cloudinary at upload; destroy() needs it.
  cloudinaryResourceType: String,
  notes: String,
  status: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], default: 'PENDING' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: Date
}, { timestamps: true });

documentAssetSchema.index({ tenantId: 1, ownerType: 1, ownerId: 1, type: 1 });

module.exports = mongoose.model('DocumentAsset', documentAssetSchema);
