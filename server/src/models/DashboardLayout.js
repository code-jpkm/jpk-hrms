const mongoose = require('mongoose');

/** Per-user dashboard widget layout, written by PUT /api/dashboard/layout. */
const dashboardLayoutSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  widgets: { type: mongoose.Schema.Types.Mixed, default: [] }
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('DashboardLayout', dashboardLayoutSchema);
