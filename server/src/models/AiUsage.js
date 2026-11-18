const mongoose = require('mongoose');

/** One row per Gemini call, so admins can see what AI is used for and whether it works. */
const aiUsageSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  feature: { type: String, index: true },
  model: String,
  ok: Boolean,
  ms: Number,
  promptTokens: Number,
  outputTokens: Number,
  error: String
}, { timestamps: { createdAt: true, updatedAt: false } });

aiUsageSchema.index({ tenantId: 1, createdAt: -1 });
aiUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 120 });

module.exports = mongoose.model('AiUsage', aiUsageSchema);
