const asyncHandler = require('../utils/asyncHandler');
const Tenant = require('../models/Tenant');
const weather = require('../services/weatherService');

// Where to look when the device location is not shared: the company's site,
// else WEATHER_LAT / WEATHER_LON, else Kolkata (the scene's sun times use it too).
const DEFAULT_POINT = {
  lat: Number(process.env.WEATHER_LAT || process.env.NEXT_PUBLIC_SCENE_LAT) || 22.57,
  lon: Number(process.env.WEATHER_LON || process.env.NEXT_PUBLIC_SCENE_LNG) || 88.36
};
const DEFAULT_PLACE = process.env.WEATHER_PLACE || (process.env.WEATHER_LAT || process.env.NEXT_PUBLIC_SCENE_LAT ? 'Office area' : 'Kolkata');

const usableSites = (tenant) => (tenant?.sites || []).filter((s) => s && s.active !== false && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)));

/** The site an employee works at: their Office / Factory site first, else the first site. */
function siteFor(tenant, workLocation) {
  const sites = usableSites(tenant);
  if (!sites.length) return null;
  const wanted = String(workLocation || '').toUpperCase() === 'FACTORY' ? 'FACTORY' : 'OFFICE';
  return sites.find((s) => s.type === wanted) || sites[0];
}

async function answer(res, where) {
  const data = await weather.lookup(where);
  // Expected now and then (Open-Meteo busy): the page just keeps its normal sky.
  if (!data) return res.status(503).json({ ok: false, message: 'Weather is not available right now' });
  res.set('Cache-Control', 'private, max-age=300');
  res.json({ ok: true, source: where.source, place: where.place, ...data });
}

/** Signed in: weather near the device (rounded to ~5 km), else at their workplace. */
exports.weatherNow = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const point = weather.snapPoint(body.lat, body.lon);
  if (point) return answer(res, { ...point, source: 'device', place: 'Near you' });
  const tenant = await Tenant.findById(req.tenantId).select('sites').lean();
  const site = siteFor(tenant, req.employee?.workLocation);
  if (site) return answer(res, { lat: site.lat, lon: site.lng, source: 'office', place: site.name });
  return answer(res, { ...DEFAULT_POINT, source: 'default', place: DEFAULT_PLACE });
});

// Sign-in pages: the company's main site only (no coordinates are taken from the
// caller, so this cannot be used as a free weather service for anywhere).
let mainSite = { at: 0, where: null };
exports.officeWeather = asyncHandler(async (req, res) => {
  if (!mainSite.where || Date.now() - mainSite.at > 10 * 60 * 1000) {
    const tenant = (await Tenant.findOne({ code: process.env.TENANT_CODE || 'JPK' }).select('sites').lean())
      || (await Tenant.findOne({ status: 'ACTIVE' }).sort({ createdAt: 1 }).select('sites').lean());
    const site = siteFor(tenant, 'OFFICE');
    mainSite = { at: Date.now(), where: site ? { lat: site.lat, lon: site.lng, source: 'office' } : { ...DEFAULT_POINT, source: 'default' } };
  }
  return answer(res, { ...mainSite.where, place: null });
});

exports._siteFor = siteFor;
