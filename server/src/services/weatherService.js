/**
 * Live weather and air quality for the scenery (Open-Meteo: no key, no sign-up).
 *
 *  - Weather: the forecast API's current conditions plus the next few hours
 *    (so the card can say "rain likely around 4 PM").
 *  - Air: the air-quality API (Copernicus CAMS model). Turned into India's
 *    National AQI (CPCB scale 0–500): 24-hour averages of PM2.5, PM10, NO2 and
 *    SO2, 8-hour averages of O3 and CO. The highest sub-index is the AQI.
 *
 * Answers are cached per ~5 km square (10 min weather, 30 min air), so one
 * office shares one lookup. If Open-Meteo is slow or down, the last answer
 * (up to 3 hours old) is used; with nothing at all the page keeps its normal sky.
 *
 * The free API is for non-commercial use. With a paid plan set
 * OPEN_METEO_API_KEY and the customer-* servers are used instead.
 */
const KEY = process.env.OPEN_METEO_API_KEY || '';
const FORECAST_URL = process.env.OPEN_METEO_FORECAST_URL
  || (KEY ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast');
const AIR_URL = process.env.OPEN_METEO_AIR_URL
  || (KEY ? 'https://customer-air-quality-api.open-meteo.com/v1/air-quality' : 'https://air-quality-api.open-meteo.com/v1/air-quality');

const WEATHER_TTL = 10 * 60 * 1000;
const AIR_TTL = 30 * 60 * 1000;
const KEEP_STALE = 3 * 60 * 60 * 1000;
const RETRY_AFTER_FAIL = 60 * 1000;
const MAX_ENTRIES = 400;
const GRID = 0.05; // ~5 km: plenty for weather, and no exact address leaves the server

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v) => (num(v) === null ? null : Math.round(Number(v)));
const round1 = (v) => (num(v) === null ? null : Math.round(Number(v) * 10) / 10);

function snapPoint(lat, lon) {
  const la = num(lat);
  const lo = num(lon);
  if (la === null || lo === null || la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  const s = (v) => Number((Math.round(v / GRID) * GRID).toFixed(2));
  return { lat: s(la), lon: s(lo) };
}

// ---------------------------------------------------------------- weather codes (WMO)
// kind drives the scene; level is how much (cloud amount or rain strength, 0–1).
const CODES = {
  0: ['clear', 0, 'Clear sky'],
  1: ['clear', 0.2, 'Mostly clear'],
  2: ['partly', 0.5, 'Partly cloudy'],
  3: ['cloudy', 0.9, 'Overcast'],
  45: ['fog', 0.7, 'Fog'],
  48: ['fog', 0.8, 'Freezing fog'],
  51: ['drizzle', 0.25, 'Light drizzle'],
  53: ['drizzle', 0.45, 'Drizzle'],
  55: ['drizzle', 0.65, 'Heavy drizzle'],
  56: ['drizzle', 0.3, 'Freezing drizzle'],
  57: ['drizzle', 0.6, 'Freezing drizzle'],
  61: ['rain', 0.35, 'Light rain'],
  63: ['rain', 0.65, 'Rain'],
  65: ['rain', 1, 'Heavy rain'],
  66: ['rain', 0.4, 'Freezing rain'],
  67: ['rain', 0.85, 'Freezing rain'],
  71: ['snow', 0.35, 'Light snow'],
  73: ['snow', 0.6, 'Snow'],
  75: ['snow', 0.9, 'Heavy snow'],
  77: ['snow', 0.4, 'Snow grains'],
  80: ['rain', 0.4, 'Light showers'],
  81: ['rain', 0.7, 'Rain showers'],
  82: ['rain', 1, 'Heavy showers'],
  85: ['snow', 0.45, 'Snow showers'],
  86: ['snow', 0.85, 'Heavy snow showers'],
  95: ['storm', 0.85, 'Thunderstorm'],
  96: ['storm', 0.95, 'Thunderstorm with hail'],
  99: ['storm', 1, 'Thunderstorm with hail']
};
const WET = ['drizzle', 'rain', 'storm'];

/** Open-Meteo forecast answer → what the scene and the card need. */
function readWeather(body, nowMs = Date.now()) {
  const c = body?.current;
  if (!c || num(c.temperature_2m) === null) return null;
  const code = round(c.weather_code);
  let [kind, level, label] = CODES[code] || ['cloudy', 0.6, 'Cloudy'];
  const precip = num(c.precipitation) || 0;
  // The model sometimes reports rain with a cloud code: trust the rain.
  if (!WET.includes(kind) && kind !== 'snow' && precip >= 0.2) [kind, level, label] = ['rain', precip >= 2 ? 0.7 : 0.35, precip >= 2 ? 'Rain' : 'Light rain'];

  // The next hours (times are local; utc_offset_seconds turns them into real instants).
  const offset = (num(body.utc_offset_seconds) || 0) * 1000;
  const times = (body.hourly?.time || []).map((t) => Date.parse(`${t}Z`) - offset);
  const prob = body.hourly?.precipitation_probability || [];
  const mm = body.hourly?.precipitation || [];
  const wet = WET.includes(kind);
  let rainChance = 0;
  let rainAt = null;
  let dryAt = null;
  const hour = 3600 * 1000;
  times.forEach((t, i) => {
    if (!Number.isFinite(t) || t < nowMs - hour || t > nowMs + 6 * hour) return;
    const p = num(prob[i]) || 0;
    const r = num(mm[i]) || 0;
    if (t <= nowMs + 3 * hour) rainChance = Math.max(rainChance, p);
    if (t <= nowMs) return;
    if (!wet && rainAt === null && (p >= 60 || r >= 0.5)) rainAt = t;
    if (wet && dryAt === null && p < 30 && r < 0.1) dryAt = t;
  });

  return {
    code,
    kind,
    level,
    label,
    isDay: c.is_day === 1 || c.is_day === true,
    temp: round(c.temperature_2m),
    feels: round(c.apparent_temperature),
    humidity: round(c.relative_humidity_2m),
    cloud: round(c.cloud_cover),
    precip: round1(precip),
    wind: round(c.wind_speed_10m),
    windDir: round(c.wind_direction_10m),
    high: round(body.daily?.temperature_2m_max?.[0]),
    low: round(body.daily?.temperature_2m_min?.[0]),
    rainChance: round(rainChance),
    rainAt: rainAt ? new Date(rainAt).toISOString() : null,
    dryAt: dryAt ? new Date(dryAt).toISOString() : null
  };
}

// ---------------------------------------------------------------- India AQI (CPCB)
// Upper concentration of each band; bands map to AQI 0–50, 51–100, 101–200,
// 201–300, 301–400, 401–500. Units µg/m³ (CO in mg/m³). The top of the last
// band only sets how fast "Severe" climbs to 500.
const AQI_BANDS = [[0, 50], [50, 100], [100, 200], [200, 300], [300, 400], [400, 500]];
const BREAKS = {
  pm25: [30, 60, 90, 120, 250, 380],
  pm10: [50, 100, 250, 350, 430, 510],
  no2: [40, 80, 180, 280, 400, 500],
  so2: [40, 80, 380, 800, 1600, 2100],
  o3: [50, 100, 168, 208, 748, 1000],
  co: [1, 2, 10, 17, 34, 50]
};
const POLLUTANT = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', so2: 'SO₂', o3: 'O₃', co: 'CO' };
const CATEGORIES = [
  { max: 50, key: 'good', label: 'Good', note: 'The air is clean. Enjoy being outside.' },
  { max: 100, key: 'satisfactory', label: 'Satisfactory', note: 'Fine for most people. Very sensitive people may feel it a little.' },
  { max: 200, key: 'moderate', label: 'Moderate', note: 'People with asthma or heart or lung problems may feel uncomfortable.' },
  { max: 300, key: 'poor', label: 'Poor', note: 'Most people feel uncomfortable after a long time outside.' },
  { max: 400, key: 'very-poor', label: 'Very poor', note: 'Long time outside can cause breathing problems. Wear a mask.' },
  { max: Infinity, key: 'severe', label: 'Severe', note: 'Harmful even for healthy people. Stay indoors if you can.' }
];

function subIndex(value, breaks) {
  let lo = 0;
  for (let i = 0; i < breaks.length; i += 1) {
    const hi = breaks[i];
    if (value <= hi || i === breaks.length - 1) {
      const [ilo, ihi] = AQI_BANDS[i];
      return Math.min(500, ilo + ((ihi - ilo) * (Math.min(value, hi) - lo)) / (hi - lo));
    }
    lo = hi;
  }
  return 500;
}

/** { pm25, pm10, no2, so2, o3, co } averages → { aqi, key, label, note, main } or null. */
function indiaAqi(conc) {
  if (num(conc.pm25) === null && num(conc.pm10) === null) return null; // CPCB needs PM2.5 or PM10
  let best = null;
  Object.keys(BREAKS).forEach((p) => {
    const v = num(conc[p]);
    if (v === null || v < 0) return;
    const index = subIndex(v, BREAKS[p]);
    if (!best || index > best.index) best = { index, p };
  });
  if (!best) return null;
  const aqi = Math.round(best.index);
  const cat = CATEGORIES.find((c) => aqi <= c.max);
  return { aqi, key: cat.key, label: cat.label, note: cat.note, main: POLLUTANT[best.p] };
}

/** Open-Meteo air-quality answer (times in GMT) → India AQI now. */
function readAir(body, nowMs = Date.now()) {
  const h = body?.hourly;
  if (!h?.time?.length) return null;
  let end = -1;
  h.time.forEach((t, i) => { if (Date.parse(`${t}Z`) <= nowMs) end = i; });
  if (end < 0) return null;
  const mean = (arr, hours) => {
    const vals = [];
    for (let i = Math.max(0, end - hours + 1); i <= end; i += 1) {
      const v = num(arr?.[i]);
      if (v !== null) vals.push(v);
    }
    // CPCB asks for at least 16 of 24 hours (two thirds).
    return vals.length >= Math.ceil(hours * 0.66) ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const co = mean(h.carbon_monoxide, 8);
  const result = indiaAqi({
    pm25: mean(h.pm2_5, 24),
    pm10: mean(h.pm10, 24),
    no2: mean(h.nitrogen_dioxide, 24),
    so2: mean(h.sulphur_dioxide, 24),
    o3: mean(h.ozone, 8),
    co: co === null ? null : co / 1000
  });
  if (!result) return null;
  return {
    ...result,
    scale: 'India (CPCB)',
    pm25: round(num(body.current?.pm2_5) ?? num(h.pm2_5[end])),
    pm10: round(num(body.current?.pm10) ?? num(h.pm10?.[end]))
  };
}

// ---------------------------------------------------------------- fetching + cache
async function fetchJson(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  if (KEY) url.searchParams.set('apikey', KEY);
  const res = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'JPK-HRMS weather scenery' } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw new Error(body?.reason || `Open-Meteo answered ${res.status}`);
  return body;
}

const weatherCache = new Map();
const airCache = new Map();

function remember(map, key, entry) {
  map.delete(key);
  map.set(key, entry);
  for (const k of map.keys()) {
    if (map.size <= MAX_ENTRIES) break;
    map.delete(k);
  }
}

function cached(map, key, ttl, load) {
  const now = Date.now();
  const hit = map.get(key);
  if (hit?.value && now - hit.at < ttl) return Promise.resolve({ value: hit.value, at: hit.at });
  if (hit?.pending) return hit.pending;
  if (hit?.failedAt && now - hit.failedAt < RETRY_AFTER_FAIL) {
    return hit.value && now - hit.at < KEEP_STALE ? Promise.resolve({ value: hit.value, at: hit.at, stale: true }) : Promise.resolve(null);
  }
  const pending = load()
    .then((value) => {
      if (!value) throw new Error('empty answer');
      remember(map, key, { value, at: Date.now() });
      return { value, at: Date.now() };
    })
    .catch((error) => {
      const old = map.get(key) || {};
      remember(map, key, { value: old.value, at: old.at, failedAt: Date.now() });
      if (process.env.NODE_ENV !== 'test') console.warn(`[weather] ${key}: ${error.message}`);
      return old.value && now - old.at < KEEP_STALE ? { value: old.value, at: old.at, stale: true } : null;
    });
  remember(map, key, { ...(hit || {}), pending });
  return pending;
}

/**
 * Weather + air for a point. Returns null only when neither is available.
 * { at, now, air } — `now` or `air` may be null on their own.
 */
async function lookup(point) {
  const p = snapPoint(point?.lat, point?.lon);
  if (!p) return null;
  const key = `${p.lat},${p.lon}`;
  const [w, a] = await Promise.all([
    cached(weatherCache, key, WEATHER_TTL, async () => readWeather(await fetchJson(FORECAST_URL, {
      latitude: p.lat,
      longitude: p.lon,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m',
      hourly: 'precipitation_probability,precipitation',
      daily: 'temperature_2m_max,temperature_2m_min',
      forecast_days: 2,
      timezone: 'auto'
    }))),
    cached(airCache, key, AIR_TTL, async () => readAir(await fetchJson(AIR_URL, {
      latitude: p.lat,
      longitude: p.lon,
      current: 'pm2_5,pm10',
      hourly: 'pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide',
      past_days: 1,
      forecast_days: 1
    })))
  ]);
  if (!w && !a) return null;
  return { at: new Date(w?.at || a?.at).toISOString(), stale: Boolean(w?.stale), now: w?.value || null, air: a?.value || null };
}

function clearCache() { weatherCache.clear(); airCache.clear(); }

module.exports = { lookup, snapPoint, readWeather, readAir, indiaAqi, clearCache };
