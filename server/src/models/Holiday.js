const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  date: { type: Date, required: true, index: true },
  location: { type: String, default: 'ALL' },
  optional: { type: Boolean, default: false }
}, { timestamps: true });

holidaySchema.index({ tenantId: 1, date: 1, name: 1 }, { unique: true });
module.exports = mongoose.model('Holiday', holidaySchema);
