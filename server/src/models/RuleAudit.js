const mongoose = require('mongoose');

const ruleAuditSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  module: { type: String, required: true, enum: ['ATTENDANCE', 'LEAVE', 'PAYROLL', 'PAYSLIP', 'SHIFT', 'AI', 'GENERAL', 'DOCUMENT_TEMPLATE', 'SALARY_MASTER', 'DOCUMENT', 'COMPANY_SETTINGS', 'EMPLOYEE', 'ACCESS'] },
  action: { type: String, required: true },
  targetId: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  reason: String,
  source: { type: String, enum: ['MANUAL', 'AI', 'SYSTEM'], default: 'MANUAL' },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('RuleAudit', ruleAuditSchema);
