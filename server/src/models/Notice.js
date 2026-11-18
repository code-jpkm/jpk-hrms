const mongoose = require('mongoose');
const noticeSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  title: { type: String, required: true, trim: true }, body: String,
  audienceLocations: [{ type: String, enum: ['OFFICE','FACTORY'] }],
  employeeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  fileName: String, mimeType: String, dataUrl: String, url: String, cloudinaryPublicId: String, cloudinaryResourceType: String,
  pinned: { type: Boolean, default: false }, expiresAt: Date,
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
module.exports = mongoose.model('Notice', noticeSchema);
