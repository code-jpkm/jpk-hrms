const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const Tenant = require('../models/Tenant');
const { recordAudit } = require('../services/auditService');
const { factoryFingerprintOnlyOn, switchOffFactoryPhoneAttendance } = require('../services/attendanceModeService');

function sanitizeSite(site = {}) {
  const name = String(site.name || '').trim();
  if (!name) throw new ApiError(400, 'Site name is required');
  const lat = Number(site.lat);
  const lng = Number(site.lng);
  const radiusMeters = Number(site.radiusMeters || 250);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new ApiError(400, `Invalid latitude for ${name}`);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new ApiError(400, `Invalid longitude for ${name}`);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) throw new ApiError(400, `Invalid radius for ${name}`);
  return {
    name,
    lat,
    lng,
    radiusMeters,
    type: ['OFFICE', 'FACTORY', 'OTHER'].includes(String(site.type || '').toUpperCase()) ? String(site.type).toUpperCase() : 'OFFICE',
    active: site.active !== false,
    address: site.address || ''
  };
}

exports.getCompanySettings = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId).lean();
  if (!tenant) throw new ApiError(404, 'Tenant not found');
  res.json({
    tenant: {
      _id: tenant._id,
      name: tenant.name,
      code: tenant.code,
      status: tenant.status,
      sites: tenant.sites || [],
      salarySlipFormat: tenant.salarySlipFormat || {},
      attendance: { factoryFingerprintOnly: factoryFingerprintOnlyOn(tenant) }
    }
  });
});

/**
 * PUT /api/company-settings/attendance — { factoryFingerprintOnly }.
 * Turning it on also switches off phone check-in, geofencing, anywhere and
 * work from home for every factory employee, so nobody keeps an old switch.
 */
exports.saveAttendanceSettings = asyncHandler(async (req, res) => {
  if (typeof req.body?.factoryFingerprintOnly !== 'boolean') throw new ApiError(400, 'factoryFingerprintOnly must be true or false');
  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant) throw new ApiError(404, 'Tenant not found');
  const before = { factoryFingerprintOnly: factoryFingerprintOnlyOn(tenant) };
  tenant.set('attendance.factoryFingerprintOnly', req.body.factoryFingerprintOnly);
  await tenant.save();
  const switchedOff = req.body.factoryFingerprintOnly ? await switchOffFactoryPhoneAttendance(req.tenantId) : [];
  await recordAudit({
    tenantId: req.tenantId,
    module: 'COMPANY_SETTINGS',
    action: 'SAVE_FACTORY_FINGERPRINT_ONLY',
    targetId: String(tenant._id),
    before,
    after: { factoryFingerprintOnly: req.body.factoryFingerprintOnly, switchedOff: switchedOff.map((e) => e.employeeCode) },
    reason: req.body.reason || (req.body.factoryFingerprintOnly ? 'Factory staff use the fingerprint machine only' : 'Factory staff may use phone attendance when HR enables it per person'),
    changedBy: req.user._id
  });
  res.json({ attendance: { factoryFingerprintOnly: req.body.factoryFingerprintOnly }, switchedOff: switchedOff.length });
});

exports.saveGeofenceSites = asyncHandler(async (req, res) => {
  const { sites = [] } = req.body;
  if (!Array.isArray(sites)) throw new ApiError(400, 'sites must be an array');
  const tenant = await Tenant.findById(req.tenantId);
  if (!tenant) throw new ApiError(404, 'Tenant not found');
  const before = { sites: tenant.sites?.map((s) => s.toObject?.() || s) || [] };
  tenant.sites = sites.map(sanitizeSite);
  await tenant.save();
  // v26: 'COMPANY_SETTINGS' was missing from the RuleAudit enum, so every save
  // returned 500 after the sites had already been stored.
  await recordAudit({
    tenantId: req.tenantId,
    module: 'COMPANY_SETTINGS',
    action: 'SAVE_GEOFENCE_SITES',
    targetId: String(tenant._id),
    before,
    after: { sites: tenant.sites.map((s) => s.toObject?.() || s) },
    reason: req.body.reason || 'Updated office/factory geofence sites',
    changedBy: req.user._id
  });
  res.json({ sites: tenant.sites });
});

/**
 * GET /api/company-settings/public — any signed-in user. Name, code and one
 * site location (office preferred) so the client can compute local sunrise /
 * sunset. No radius, address or other configuration is exposed.
 */
exports.publicSettings = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.tenantId).select('name code sites').lean();
  if (!tenant) throw new ApiError(404, 'Tenant not found');
  const sites = (tenant.sites || []).filter((site) => site.active !== false && Number.isFinite(site.lat) && Number.isFinite(site.lng));
  const site = sites.find((x) => x.type === 'OFFICE') || sites[0] || null;
  res.json({
    name: tenant.name,
    code: tenant.code,
    primarySite: site ? { name: site.name, lat: site.lat, lng: site.lng } : null
  });
});
