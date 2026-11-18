const mongoose = require('mongoose');

const attendancePolicySchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true, index: true },
  name: { type: String, default: 'Default Attendance Deduction Rule' },
  timezoneOffsetMinutes: { type: Number, default: 330 },
  // How long after shift end an un-punched-out day stays open for check-out.
  // Past this the day is auto-closed with a blank out time so the next morning's
  // punch can never be mistaken for yesterday's check-out.
  autoCloseOpenPunchAfterMinutes: { type: Number, default: 180 },
  lateGraceMinutes: { type: Number, default: 15 },
  lateGraceDaysPerMonth: { type: Number, default: 3 },
  lateLopAfterGraceDays: { type: Number, default: 0.5 },
  permissionLimitPerMonth: { type: Number, default: 3 },
  earlyLeaveAllowedMinutes: { type: Number, default: 15 },
  earlyLeavePermissionRequiredAfterMinutes: { type: Number, default: 15 },
  earlyLeaveHalfDayAfterMinutes: { type: Number, default: 120 },
  earlyLeaveLopDays: { type: Number, default: 0.5 },
  // What a punch pair shorter than the shift's half-day minimum counts as.
  // HALF_DAY keeps the v25 behaviour; ABSENT is the stricter, common rule.
  belowHalfDayStatus: { type: String, enum: ['HALF_DAY', 'ABSENT'], default: 'HALF_DAY' },
  medicalSpecialRequiresHr: { type: Boolean, default: true },
  customRules: [{
    name: String,
    condition: { type: String, enum: ['LATE_IN_MINUTES_GT', 'EARLY_LEAVE_MINUTES_GT', 'ABSENT', 'HALF_DAY', 'MANUAL'], default: 'MANUAL' },
    thresholdMinutes: { type: Number, default: 0 },
    lopDays: { type: Number, default: 0 },
    requiresPermission: { type: Boolean, default: false },
    priority: { type: Number, default: 100 },
    active: { type: Boolean, default: true }
  }],
  active: { type: Boolean, default: true }

}, { timestamps: true });

module.exports = mongoose.model('AttendancePolicy', attendancePolicySchema);
