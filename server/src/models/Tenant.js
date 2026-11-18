const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
  sites: [{
    name: String,
    lat: Number,
    lng: Number,
    radiusMeters: { type: Number, default: 250 },
    type: { type: String, enum: ['OFFICE', 'FACTORY', 'OTHER'], default: 'OFFICE' },
    address: String,
    active: { type: Boolean, default: true }
  }],
  salarySlipFormat: {
    showLogo: { type: Boolean, default: false },
    companyAddress: String,
    footerText: String
  }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
