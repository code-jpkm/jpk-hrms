const mongoose = require('mongoose');

const aiCommandLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  prompt: { type: String, required: true },
  intent: String,
  parsed: mongoose.Schema.Types.Mixed,
  result: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ['SUCCESS', 'FAILED', 'NEEDS_REVIEW'], default: 'SUCCESS' },
  error: String,
  executed: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('AiCommandLog', aiCommandLogSchema);
