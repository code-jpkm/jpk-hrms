const mongoose = require('mongoose');

const moneyField = { type: Number, default: 0, min: 0 };

const salaryMasterSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  effectiveMonth: { type: String, required: true }, // YYYY-MM
  earnings: {
    basic: moneyField,
    hra: moneyField,
    conveyance: moneyField,
    specialAllowance: moneyField,
    otherEarnings: moneyField
  },
  deductions: {
    pf: moneyField,
    esi: moneyField,
    ptax: moneyField,
    otherDeductions: moneyField
  },
  grossSalary: moneyField,
  totalDeductions: moneyField,
  netSalary: moneyField,
  calculationMode: { type: String, enum: ['MANUAL', 'RULE_BASED_DEDUCTIONS'], default: 'RULE_BASED_DEDUCTIONS' },
  locked: { type: Boolean, default: false },
  notes: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

salaryMasterSchema.index({ tenantId: 1, employeeId: 1, effectiveMonth: 1 }, { unique: true });
salaryMasterSchema.pre('validate', function calculateTotals(next) {
  const e = this.earnings || {};
  const d = this.deductions || {};
  this.grossSalary = Number(e.basic || 0) + Number(e.hra || 0) + Number(e.conveyance || 0) + Number(e.specialAllowance || 0) + Number(e.otherEarnings || 0);
  this.totalDeductions = Number(d.pf || 0) + Number(d.esi || 0) + Number(d.ptax || 0) + Number(d.otherDeductions || 0);
  this.netSalary = this.grossSalary - this.totalDeductions;
  next();
});

module.exports = mongoose.model('SalaryMaster', salaryMasterSchema);
