const mongoose = require('mongoose');

const payslipTemplateSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, default: 'Default Payslip Format' },
  active: { type: Boolean, default: true },
  companyName: String,
  companyAddress: String,
  headerText: String,
  footerText: String,
  primaryColor: { type: String, default: '#1F3445' },
  showBankLast4: { type: Boolean, default: true },
  // Bank account number on the payslip: in full (as on JPK's payslip), last 4 digits, or not at all.
  bankAccountDisplay: { type: String, enum: ['FULL', 'LAST4', 'HIDE'], default: 'FULL' },
  showPfEsiNumbers: { type: Boolean, default: true },
  showAttendanceSummary: { type: Boolean, default: true },
  earningsLabels: [{ key: String, label: String }],
  deductionLabels: [{ key: String, label: String }],
  customLines: [{ label: String, value: String }]
}, { timestamps: true });

payslipTemplateSchema.index({ tenantId: 1, active: 1 });
module.exports = mongoose.model('PayslipTemplate', payslipTemplateSchema);
