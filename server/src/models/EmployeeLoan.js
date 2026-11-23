const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * A loan or salary advance recovered from salary, a fixed instalment (EMI) every
 * month. What has been recovered is read from the payslips' LOAN line (see
 * services/loanService.js), so the loan itself only stores what was agreed.
 */
const employeeLoanSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  // The loans collection already has a unique index on referenceNumber (salary
  // advances "ADV-…" from the earlier HRMS), so every loan gets its own reference.
  referenceNumber: { type: String, default: () => `LN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}` },
  name: { type: String, default: 'Loan', trim: true, maxlength: 60 },
  // The loan given.
  amount: { type: Number, required: true, min: 0 },
  // Taken off the payslip each month; the last instalment is only what is left.
  emi: { type: Number, required: true, min: 1 },
  // Still to recover from the first instalment month on. A loan given in the
  // HRMS: the loan amount. A loan brought over from greytHR: its balance then.
  balanceAtStart: { type: Number, required: true, min: 0 },
  // First payslip month with an instalment, YYYY-MM.
  startMonth: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  loanDate: Date,
  status: { type: String, enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE' },
  // Closed by HR (paid back another way, waived…): no instalment from this month on.
  closedMonth: String,
  closedReason: String,
  source: { type: String, enum: ['HRMS', 'GREYTHR', 'EXCEL'], default: 'HRMS' },
  notes: { type: String, maxlength: 300 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

employeeLoanSchema.index({ tenantId: 1, employeeId: 1, startMonth: 1 });

module.exports = mongoose.model('EmployeeLoan', employeeLoanSchema);
