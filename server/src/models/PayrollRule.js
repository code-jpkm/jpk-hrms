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
  // Whole rupees on every slip line (LOP, components, PF / ESI / PT), like JPK's own payslips.
  roundToRupee: { type: Boolean, default: true },
  // A month's payroll opens on the 1st of the next month (November's on 1 December),
  // and employees never see a payslip for a month that has not ended.
  lockUntilMonthEnds: { type: Boolean, default: true },
  // What a month's salary is divided by for one LOP day. CALENDAR_DAYS: every
  // day of the month (31 in October), as on JPK's payslips and in greytHR.
  // WORKING_DAYS: only the scheduled working days (no Sundays / holidays).
  // WAGES staff always use the days less Sundays.
  lopDayBasis: { type: String, enum: ['CALENDAR_DAYS', 'WORKING_DAYS'], default: 'CALENDAR_DAYS' },
  notes: String
}, { timestamps: true });

module.exports = mongoose.model('PayrollRule', payrollRuleSchema);
