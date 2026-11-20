const mongoose = require('mongoose');

const payrollRunSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  month: { type: String, required: true },
  status: { type: String, enum: ['DRAFT', 'FINALIZED'], default: 'DRAFT' },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  releasedAt: Date,
  releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  summary: {
    employeeCount: Number,
    grossTotal: Number,
    deductionTotal: Number,
    netTotal: Number
  }
}, { timestamps: true });

payrollRunSchema.index({ tenantId: 1, month: 1 }, { unique: true });
module.exports = mongoose.model('PayrollRun', payrollRunSchema);
