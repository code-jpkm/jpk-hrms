const mongoose = require('mongoose');
const { addMonthsClamped } = require('../utils/date');

const documentSchema = new mongoose.Schema({
  label: String,
  type: String,
  fileName: String,
  url: String,
  notes: String
}, { _id: false });

const employeeSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employeeCode: { type: String, required: true, trim: true },
  firstName: { type: String, required: true },
  lastName: { type: String, default: '' },
  email: { type: String, lowercase: true, trim: true },
  phone: String,
  profilePhotoUrl: String,
  department: String,
  designation: String,
  workLocation: { type: String, enum: ['OFFICE', 'FACTORY', 'BOTH'], default: 'FACTORY', index: true },
  employeeCategory: { type: String, enum: ['SALARIED', 'WAGES'], default: 'SALARIED' },
  needsProfileReview: { type: Boolean, default: false, index: true },
  profileReviewMissing: [{ type: String }],
  profileMigrationVersion: { type: Number, default: 22 },
  employmentType: { type: String, enum: ['FRESHER', 'EXPERIENCED'], default: 'FRESHER' },
  previousExperienceYears: { type: Number, default: 0 },
  previousCompany: String,
  dateOfJoining: Date,
  dateOfBirth: Date,
  reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  status: { type: String, enum: ['ONBOARDING', 'ACTIVE', 'PROBATION', 'CONFIRMED', 'OFFBOARDED'], default: 'ACTIVE' },
  probation: {
    enabled: { type: Boolean, default: true },
    months: { type: Number, default: 6 },
    startDate: Date,
    endDate: Date,
    status: { type: String, enum: ['NOT_APPLICABLE', 'RUNNING', 'CONFIRMATION_DUE', 'CONFIRMED', 'EXTENDED'], default: 'RUNNING' },
    extendedUntil: Date,
    lastReminderAt: Date,
    confirmedAt: Date,
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  canUseGeofencing: { type: Boolean, default: false },
  canUseAnywhereAttendance: { type: Boolean, default: false },
  canApplyWfh: { type: Boolean, default: false },
  biometric: {
    code: String,
    deviceUserId: String
  },
  personalDetails: {
    gender: String,
    maritalStatus: String,
    bloodGroup: String,
    fatherName: String,
    motherName: String,
    spouseName: String,
    currentAddress: String,
    permanentAddress: String
  },
  emergencyContact: {
    name: String,
    relation: String,
    phone: String,
    alternatePhone: String
  },
  bankDetails: {
    bankName: String,
    branchName: String,
    accountNumber: String,
    ifsc: String,
    salaryBankName: String,
    salaryAccountNumber: String,
    salaryIfsc: String
  },
  statutory: {
    aadharNumber: String,
    pan: String,
    pfNumber: String,
    uan: String,
    esiNumber: String,
    ptaxNumber: String,
    pfApplicable: { type: Boolean, default: true },
    esiApplicable: { type: Boolean, default: true },
    ptaxApplicable: { type: Boolean, default: true }
  },
  onboardingDocuments: {
    aadharCard: documentSchema,
    panCard: documentSchema,
    previousCompanyPayslip: documentSchema,
    previousCompanyBankStatement: documentSchema,
    experienceLetter: documentSchema,
    resume: documentSchema,
    otherDocuments: [documentSchema]
  },
  salary: {
    basic: { type: Number, default: 0 },
    hra: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    bankAccountLast4: String,
    pfNumber: String,
    esiNumber: String,
    pan: String
  }
}, { timestamps: true });

employeeSchema.index({ tenantId: 1, employeeCode: 1 }, { unique: true });
employeeSchema.virtual('fullName').get(function fullName() {
  return `${this.firstName} ${this.lastName || ''}`.trim();
});
/**
 * Probation bookkeeping.
 *
 * v26: this used to run on EVERY save and push anyone with a joining date onto
 * probation (ACTIVE -> PROBATION, probation RUNNING), including staff who joined
 * years before they were entered into the HRMS. Monthly EL accrual skips
 * PROBATION, and the reminder job asked managers every day to confirm them.
 * It also never recomputed the end date when a wrong joining date was fixed.
 *
 * Now probation is only defaulted for a new record whose end date is still in
 * the future, and recomputed when the joining date / length changes on a
 * probation that has not been decided. Month-end is clamped (31 Aug + 6 = 28 Feb).
 */
const UNDECIDED_PROBATION = ['RUNNING', 'CONFIRMATION_DUE', 'EXTENDED', 'NOT_APPLICABLE'];
employeeSchema.pre('validate', function setProbationDates(next) {
  const probation = this.probation;
  if (!probation || !this.dateOfJoining || probation.enabled === false) return next();
  const datesChanged = this.isNew || this.isModified('dateOfJoining') || this.isModified('probation.months');
  const status = probation.status || 'RUNNING';
  if (!datesChanged || !UNDECIDED_PROBATION.includes(status)) return next();
  if (this.isNew && this.status === 'CONFIRMED') { probation.status = 'CONFIRMED'; return next(); }
  // HR explicitly opted this new joiner out of probation.
  if (this.isNew && status === 'NOT_APPLICABLE' && !this.$isDefault('probation.status')) return next();

  const baseEnd = addMonthsClamped(this.dateOfJoining, Number(probation.months || 6));
  const supplied = this.isNew && probation.endDate ? new Date(probation.endDate) : null;
  const extendedUntil = status === 'EXTENDED' && probation.extendedUntil ? new Date(probation.extendedUntil) : null;
  const endDate = supplied || (extendedUntil && extendedUntil > baseEnd ? extendedUntil : baseEnd);

  if (endDate > new Date()) {
    probation.startDate = this.dateOfJoining;
    probation.endDate = endDate;
    if (['NOT_APPLICABLE', 'CONFIRMATION_DUE'].includes(status)) probation.status = 'RUNNING';
    if (this.status === 'ACTIVE') this.status = 'PROBATION';
  } else if (this.isNew || ['RUNNING', 'NOT_APPLICABLE'].includes(status)) {
    // Probation would already be over: do not open (or keep) one by default.
    probation.status = 'NOT_APPLICABLE';
    probation.startDate = undefined;
    probation.endDate = undefined;
    if (this.status === 'PROBATION') this.status = 'ACTIVE';
  } else {
    // CONFIRMATION_DUE / EXTENDED wait on a manager decision: keep the state,
    // only move the due date to match the corrected joining date.
    probation.startDate = this.dateOfJoining;
    probation.endDate = endDate;
  }
  next();
});
employeeSchema.set('toJSON', { virtuals: true });
employeeSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Employee', employeeSchema);
