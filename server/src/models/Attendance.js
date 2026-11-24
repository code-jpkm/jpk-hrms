const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  date: { type: Date, required: true, index: true },
  checkIn: Date,
  checkOut: Date,
  status: { type: String, enum: ['PRESENT', 'ABSENT', 'HALF_DAY', 'WFH', 'LEAVE', 'HOLIDAY', 'WEEK_OFF'], default: 'PRESENT' },
  dayPart: { type: String, enum: ['FULL', 'FIRST_HALF', 'SECOND_HALF'], default: 'FULL' },
  source: { type: String, enum: ['BIOMETRIC', 'MOBILE_GEOFENCE', 'ANYWHERE', 'WFH', 'OVERRIDE', 'SYSTEM'], default: 'SYSTEM' },
  location: {
    lat: Number,
    lng: Number,
    // How close the phone said the point is, in metres (GPS accuracy).
    accuracy: Number,
    siteName: String,
    distanceMeters: Number,
    address: String
  },
  biometricDeviceId: String,
  overrideRemarks: String,
  overrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  regularizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Regularization' },
  permissionRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PermissionRequest' },
  lateMinutes: { type: Number, default: 0 },
  earlyLeaveMinutes: { type: Number, default: 0 },
  graceUsed: { type: Boolean, default: false },
  // How many late/early events on THIS day actually consumed the monthly
  // exception quota. Absent days and unrescued half-days record 0: the quota is
  // a benefit that only applies to a day the employee actually worked.
  exceptionEventsCounted: { type: Number, default: 0 },
  // Set when a duty day was closed by the system because the employee never
  // punched out. checkOut stays NULL — we never invent a time.
  autoClosed: { type: Boolean, default: false },
  autoClosedAt: Date,
  missingCheckOut: { type: Boolean, default: false },
  // A past duty day with only one punch (usually the out time is missing). It is
  // never loss of pay on its own: the calendar shows it in yellow until HR /
  // admin decides (set the time, or count it present / half day / absent).
  needsReview: { type: Boolean, default: false },
  lopDays: { type: Number, default: 0 },
  lopOverride: {
    enabled: { type: Boolean, default: false },
    originalLopDays: Number,
    overrideLopDays: Number,
    reason: String,
    category: { type: String, enum: ['MEDICAL', 'SPECIAL', 'MANAGEMENT_APPROVAL', 'SYSTEM_CORRECTION', 'OTHER'] },
    overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    overriddenAt: Date
  },
  deductionReason: String,
  policySnapshot: mongoose.Schema.Types.Mixed,
  evaluatedAt: Date,
  meta: mongoose.Schema.Types.Mixed
}, { timestamps: true });

attendanceSchema.index({ tenantId: 1, employeeId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
