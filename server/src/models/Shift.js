const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  code: String,
  startTime: { type: String, default: '09:30' },
  endTime: { type: String, default: '18:30' },
  crossesMidnight: { type: Boolean, default: false },
  durationMinutes: { type: Number, default: 0 },
  graceMinutes: { type: Number, default: 10 },
  allowedEarlyInMinutes: { type: Number, default: 120 },
  allowedLateOutMinutes: { type: Number, default: 120 },
  halfDayMinutes: { type: Number, default: 240 },
  fullDayMinutes: { type: Number, default: 480 },
  weeklyOffDays: [{ type: Number }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

shiftSchema.index({ tenantId: 1, name: 1 }, { unique: true });
module.exports = mongoose.model('Shift', shiftSchema);
