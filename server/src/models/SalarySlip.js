const mongoose = require('mongoose');

const salarySlipSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  payrollRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRun', required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  salaryMasterId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalaryMaster' },
  salaryMasterEffectiveMonth: String,
  month: { type: String, required: true },
  attendanceStats: mongoose.Schema.Types.Mixed,
  earnings: mongoose.Schema.Types.Mixed,
  deductions: mongoose.Schema.Types.Mixed,
  manualAdjustments: mongoose.Schema.Types.Mixed,
  // LOP waterfall audit trail (which component absorbed the loss of pay).
  lop: mongoose.Schema.Types.Mixed,
  netPay: Number,
  generatedAt: Date,
  lastSharedAt: Date,
  sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sharedChannels: [{ type: String, enum: ['EMAIL', 'WHATSAPP'] }],
  shareTokenHash: String,
  shareTokenExpiresAt: Date
}, { timestamps: true });

salarySlipSchema.index({ tenantId: 1, employeeId: 1, month: 1 }, { unique: true });
module.exports = mongoose.model('SalarySlip', salarySlipSchema);
