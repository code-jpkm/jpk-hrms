const mongoose = require('mongoose');

const payrollRuleSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, default: 'Default Payroll Rule' },
  active: { type: Boolean, default: true },
  pf: {
    enabled: { type: Boolean, default: true },
    employeePercent: { type: Number, default: 0.12 },
    employerPercent: { type: Number, default: 0.12 },
    wageCap: { type: Number, default: 15000 },
    calculationBase: { type: String, enum: ['BASIC', 'GROSS'], default: 'BASIC' },
    applyWageCap: { type: Boolean, default: true }
  },
  esi: {
    enabled: { type: Boolean, default: true },
    employeePercent: { type: Number, default: 0.0075 },
    employerPercent: { type: Number, default: 0.0325 },
    grossCap: { type: Number, default: 21000 },
    calculationBase: { type: String, enum: ['GROSS', 'BASIC'], default: 'GROSS' }
  },
  ptax: {
    enabled: { type: Boolean, default: true },
    defaultAmount: { type: Number, default: 200 },
    slabs: [{ from: Number, to: Number, amount: Number }]
  },
  customEarnings: [{ name: String, amount: Number, percent: Number, calculationBase: { type: String, enum: ['BASIC', 'GROSS'], default: 'GROSS' }, enabled: { type: Boolean, default: true } }],
  customDeductions: [{ name: String, amount: Number, percent: Number, calculationBase: { type: String, enum: ['BASIC', 'GROSS'], default: 'GROSS' }, enabled: { type: Boolean, default: true } }],
  notes: String
}, { timestamps: true });

module.exports = mongoose.model('PayrollRule', payrollRuleSchema);
