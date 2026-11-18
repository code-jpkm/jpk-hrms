const mongoose = require('mongoose');

const rawPunchLogSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  biometricDeviceMongoId: { type: mongoose.Schema.Types.ObjectId, ref: 'BiometricDevice', index: true },
  deviceId: { type: String, required: true, index: true },
  locationName: String,
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true },
  employeeCode: String,
  deviceUserId: String,
  timestamp: { type: Date, required: true, index: true },
  punchType: { type: String, enum: ['IN', 'OUT', 'UNKNOWN'], default: 'UNKNOWN' },
  imported: { type: Boolean, default: false },
  importedAttendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance' },
  skippedReason: String,
  // ADMS punches are saved first (pending) and added to attendance right after.
  pending: { type: Boolean, default: false },
  source: String,
  receivedAt: Date,
  raw: mongoose.Schema.Types.Mixed
}, { timestamps: true });

rawPunchLogSchema.index({ tenantId: 1, deviceId: 1, deviceUserId: 1, timestamp: 1 }, { unique: true });
rawPunchLogSchema.index({ tenantId: 1, biometricDeviceMongoId: 1, pending: 1, timestamp: 1 });
rawPunchLogSchema.index({ tenantId: 1, deviceUserId: 1, timestamp: -1 });
module.exports = mongoose.model('RawPunchLog', rawPunchLogSchema);
