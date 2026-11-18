const mongoose = require('mongoose');

const biometricDeviceSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true, trim: true },
  vendor: { type: String, enum: ['ESSL', 'ZKTECO', 'OTHER'], default: 'ESSL' },
  deviceId: { type: String, required: true, trim: true },
  serialNumber: String,
  locationName: { type: String, required: true, trim: true },
  ip: String,
  port: { type: Number, default: 4370 },
  // ADMS: the machine sends punches to /iclock/* by itself (eSSL / ZKTeco "Cloud Server").
  mode: { type: String, enum: ['ADMS', 'PUSH', 'HTTP_PULL', 'ZKTECO_DIRECT', 'MANUAL_JSON', 'MOCK'], default: 'PUSH' },
  apiUrl: String,
  apiToken: String,
  enabled: { type: Boolean, default: true },
  syncEveryMinutes: { type: Number, default: 5 },
  timezoneOffsetMinutes: { type: Number, default: 330 },
  lastSyncAt: Date,
  lastSuccessAt: Date,
  lastError: String,
  lastImportedCount: { type: Number, default: 0 },
  status: { type: String, enum: ['READY', 'SYNCING', 'OK', 'ERROR', 'DISABLED'], default: 'READY' },
  notes: String,

  // ---- ADMS (machine pushes by itself) -----------------------------------
  // A machine that contacts the HRMS for the first time is registered here and
  // waits for HR to approve it. Until then its punches are kept, not used.
  approved: { type: Boolean, default: false },
  approvedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Punches before this India calendar day (YYYY-MM-DD) are kept but not added to attendance.
  importFrom: String,
  firstSeenAt: Date,
  lastSeenAt: Date,
  lastIp: String,
  pushVersion: String,
  firmware: String,
  machineInfo: {
    users: Number,
    fingerprints: Number,
    faces: Number,
    punches: Number,
    ip: String
  },
  attlogStamp: String,
  operlogStamp: String,
  totalPunches: { type: Number, default: 0 },
  lastPunchAt: Date,
  lastPunchReceivedAt: Date,
  // Names as enrolled on the machine, to help link machine IDs to employees.
  machineUsers: { type: [{ pin: String, name: String, _id: false }], default: undefined },
  // How far the machine's clock was behind India time when last checked (0 = fine).
  clockOffsetMinutes: { type: Number, default: 0 },
  clockCheckedAt: Date
}, { timestamps: true });

biometricDeviceSchema.index({ serialNumber: 1, mode: 1 });

biometricDeviceSchema.index({ tenantId: 1, deviceId: 1 }, { unique: true });
module.exports = mongoose.model('BiometricDevice', biometricDeviceSchema);
