import { useEffect, useSyncExternalStore } from 'react';
import { api, getToken, post } from '../api/client.js';

/**
 * Live weather for the scenery and the weather card.
 *
 * Signed in: the browser's location (asked once; rounded to ~5 km before it is
 * sent), else the person's office / factory site. Sign-in pages: the company's
 * main site. The last answer is kept in this browser so the next page opens
 * with the right sky straight away; it is refreshed every 15 minutes.
 *
 * Preview any weather with ?sceneWeather=rain (clear, partly, cloudy, fog,
 * drizzle, rain, heavy, storm, snow) and ?sceneAqi=250 in the address bar.
 */

const SAVE_KEY = 'hrms_weather_v1';
const ASKED_KEY = 'hrms_weather_asked_location';
const FRESH_MS = 15 * 60 * 1000;
const KEEP_MS = 3 * 60 * 60 * 1000;
const GRID = 0.05;

const hasWindow = typeof window !== 'undefined';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const read = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } };

function readSaved() {
  if (!hasWindow) return null;
  try {
    const saved = JSON.parse(read(SAVE_KEY) || 'null');
    if (saved?.data?.ok && Date.now() - saved.savedAt < KEEP_MS) return saved;
  } catch { /* ignore */ }
  return null;
}

let state = { data: readSaved()?.data || null, loading: false, askable: false, blocked: false };
const subscribers = new Set();
const emit = (patch) => { state = { ...state, ...patch }; subscribers.forEach((fn) => fn()); };
const subscribe = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };
const snapshot = () => state;

async function locationPermission() {
  try {
    if (navigator.permissions?.query) return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch { /* Safari before 16 */ }
  return 'unknown';
}

function devicePoint() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    const snap = (v) => Number((Math.round(v / GRID) * GRID).toFixed(2));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: snap(p.coords.latitude), lon: snap(p.coords.longitude) }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 30 * 60 * 1000, timeout: 10000 }
    );
  });
}

let pending = null;
let triedDevice = false;

/**
 * Fetches when the saved answer is older than 15 minutes (or force).
 * askLocation: the person pressed "Use my location".
 */
export function refreshWeather({ publicOnly = false, force = false, askLocation = false } = {}) {
  if (!hasWindow) return Promise.resolve(null);
  if (pending) return pending;
  const saved = readSaved();
  const signedIn = !publicOnly && Boolean(getToken());
  const fresh = saved && Date.now() - saved.savedAt < FRESH_MS;
  if (!force && fresh && (!signedIn || saved.data.source === 'device' || triedDevice)) {
    if (state.data !== saved.data) emit({ data: saved.data });
    return Promise.resolve(saved.data);
  }

  pending = (async () => {
    emit({ loading: true });
    let data = null;
    if (signedIn) {
      triedDevice = true;
      let point = null;
      const permission = await locationPermission();
      if (permission === 'granted' || askLocation || (permission !== 'denied' && !read(ASKED_KEY))) {
        write(ASKED_KEY, '1');
        point = await devicePoint();
      }
      const after = point ? 'granted' : await locationPermission();
      emit({ askable: !point && after !== 'denied' && Boolean(navigator.geolocation), blocked: !point && after === 'denied' });
      try { data = await post('/weather/now', point || {}, { toast: false }); } catch { data = null; }
    }
    if (!data?.ok) {
      try { data = await api('/weather/office', { toast: false }); } catch { data = null; }
    }
    if (data?.ok) {
      write(SAVE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
      emit({ data, loading: false });
    } else {
      emit({ loading: false, data: state.data || saved?.data || null });
    }
    pending = null;
    return data;
  })();
  return pending;
}

// ---------------------------------------------------------------- preview (?sceneWeather=…)
const PREVIEWS = {
  clear: { code: 0, kind: 'clear', level: 0, label: 'Clear sky', cloud: 5, temp: 27, feels: 29, humidity: 55, wind: 8 },
  partly: { code: 2, kind: 'partly', level: 0.5, label: 'Partly cloudy', cloud: 45, temp: 28, feels: 31, humidity: 62, wind: 10 },
  cloudy: { code: 3, kind: 'cloudy', level: 0.9, label: 'Overcast', cloud: 100, temp: 25, feels: 27, humidity: 78, wind: 12 },
  fog: { code: 45, kind: 'fog', level: 0.7, label: 'Fog', cloud: 90, temp: 18, feels: 18, humidity: 97, wind: 3 },
  drizzle: { code: 53, kind: 'drizzle', level: 0.45, label: 'Drizzle', cloud: 100, temp: 24, feels: 26, humidity: 92, wind: 9, precip: 0.3 },
  rain: { code: 63, kind: 'rain', level: 0.65, label: 'Rain', cloud: 100, temp: 24, feels: 26, humidity: 94, wind: 16, precip: 2.4 },
  heavy: { code: 65, kind: 'rain', level: 1, label: 'Heavy rain', cloud: 100, temp: 23, feels: 25, humidity: 97, wind: 24, precip: 8 },
  storm: { code: 95, kind: 'storm', level: 0.85, label: 'Thunderstorm', cloud: 100, temp: 23, feels: 25, humidity: 96, wind: 32, precip: 9 },
  snow: { code: 73, kind: 'snow', level: 0.6, label: 'Snow', cloud: 100, temp: -2, feels: -6, humidity: 90, wind: 10 }
};

function previewFrom(data) {
  if (!hasWindow) return data;
  let q;
  try { q = new URLSearchParams(window.location.search); } catch { return data; }
  const kind = q.get('sceneWeather');
  const aqi = q.get('sceneAqi');
  if (!kind && !aqi) return data;
  const base = data || { ok: true, source: 'preview', place: 'Preview', at: new Date().toISOString(), now: PREVIEWS.clear, air: null };
  const now = PREVIEWS[kind] ? { ...(base.now || {}), ...PREVIEWS[kind], isDay: base.now?.isDay ?? true, rainChance: ['rain', 'heavy', 'storm', 'drizzle'].includes(kind) ? 90 : 10, rainAt: null, dryAt: null } : base.now;
  let air = base.air;
  if (aqi !== null && Number.isFinite(Number(aqi))) {
    const v = clamp(Math.round(Number(aqi)), 0, 500);
    const c = aqiCategory(v);
    air = { aqi: v, key: c.key, label: c.label, note: c.note, main: 'PM2.5', scale: 'India (CPCB)', pm25: Math.round(v * 0.6), pm10: Math.round(v * 1.1) };
  }
  return { ...base, now, air };
}

/** { data, loading, askable, blocked } — shared by every scene on the page. */
export function useWeather({ mode = 'auto' } = {}) {
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (mode === 'off') return undefined;
    const publicOnly = mode === 'public';
    refreshWeather({ publicOnly });
    const tick = () => { if (!document.hidden) refreshWeather({ publicOnly }); };
    const id = window.setInterval(tick, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [mode]);
  if (mode === 'off') return { ...snap, data: null };
  return { ...snap, data: previewFrom(snap.data) };
}

// ---------------------------------------------------------------- how the scene looks
/**
 * Numbers for the scenery, all 0–1: cover (clouds), gloom (darker, greyer),
 * rain, snow, fog, smog (from the AQI), storm (lightning), wind (km/h).
 */
export function weatherLook(data) {
  const now = data?.now;
  const aqi = Number(data?.air?.aqi);
  if (!now && !Number.isFinite(aqi)) return null;
  const level = clamp(Number(now?.level ?? 0.5), 0, 1);
  const cloudPct = Number.isFinite(Number(now?.cloud)) && now?.cloud !== null ? clamp(Number(now.cloud) / 100, 0, 1) : null;
  const L = { kind: now?.kind || 'clear', cover: 0, gloom: 0, rain: 0, snow: 0, fog: 0, smog: 0, storm: false, wind: clamp(Number(now?.wind) || 8, 0, 80), windDir: Number.isFinite(Number(now?.windDir)) && now?.windDir !== null ? Number(now.windDir) : NaN };
  switch (L.kind) {
    case 'partly': L.cover = 0.3 + 0.3 * (cloudPct ?? level); L.gloom = 0.06; break;
    case 'cloudy': L.cover = 0.8 + 0.2 * (cloudPct ?? 1); L.gloom = 0.3; break;
    case 'fog': L.cover = 0.7; L.gloom = 0.18; L.fog = 0.85; break;
    case 'drizzle': L.cover = 0.88; L.gloom = 0.36; L.rain = 0.22 + 0.2 * level; L.fog = 0.15; break;
    case 'rain': L.cover = 0.95; L.gloom = 0.42 + 0.24 * level; L.rain = 0.45 + 0.55 * level; L.fog = 0.1 + 0.2 * level; break;
    case 'storm': L.cover = 1; L.gloom = 0.74; L.rain = 0.85 + 0.15 * level; L.fog = 0.2; L.storm = true; break;
    case 'snow': L.cover = 0.9; L.gloom = 0.18; L.snow = 0.4 + 0.6 * level; L.fog = 0.15; break;
    default: L.cover = Math.min(0.22, (cloudPct ?? 0.05) * 0.4);
  }
  if (Number.isFinite(aqi)) {
    if (aqi > 400) L.smog = 0.7 + 0.15 * Math.min(1, (aqi - 400) / 100);
    else if (aqi > 300) L.smog = 0.52 + 0.18 * ((aqi - 300) / 100);
    else if (aqi > 200) L.smog = 0.32 + 0.2 * ((aqi - 200) / 100);
    else if (aqi > 100) L.smog = 0.1 + 0.2 * ((aqi - 100) / 100);
  }
  return L;
}

// ---------------------------------------------------------------- words, colours, icons
const CATS = [
  { max: 50, key: 'good', label: 'Good', note: 'The air is clean. Enjoy being outside.' },
  { max: 100, key: 'satisfactory', label: 'Satisfactory', note: 'Fine for most people. Very sensitive people may feel it a little.' },
  { max: 200, key: 'moderate', label: 'Moderate', note: 'People with asthma or heart or lung problems may feel uncomfortable.' },
  { max: 300, key: 'poor', label: 'Poor', note: 'Most people feel uncomfortable after a long time outside.' },
  { max: 400, key: 'very-poor', label: 'Very poor', note: 'Long time outside can cause breathing problems. Wear a mask.' },
  { max: Infinity, key: 'severe', label: 'Severe', note: 'Harmful even for healthy people. Stay indoors if you can.' }
];
export const aqiCategory = (aqi) => CATS.find((c) => aqi <= c.max) || CATS[CATS.length - 1];

// The colours of India's AQI bulletin, a touch softer so they sit well on the page.
export const AQI_COLORS = { good: '#2E9E4F', satisfactory: '#86BC42', moderate: '#E3B505', poor: '#EE8A1B', 'very-poor': '#DC3A2F', severe: '#9C1D33' };

export function weatherIcon(now, period) {
  const night = now ? now.isDay === false : period === 'night';
  switch (now?.kind) {
    case 'partly': return night ? 'CloudMoon' : 'CloudSun';
    case 'cloudy': return 'Cloud';
    case 'fog': return 'CloudFog';
    case 'drizzle': return 'CloudDrizzle';
    case 'rain': return now.level >= 0.9 ? 'CloudRain' : night ? 'CloudMoonRain' : 'CloudSunRain';
    case 'storm': return 'CloudLightning';
    case 'snow': return 'CloudSnow';
    default: return night ? 'Moon' : 'Sun';
  }
}

const IST_HOUR = (iso) => {
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).replace(':00', '').toUpperCase(); } catch { return ''; }
};

/** One short, useful line for right now. */
export function weatherTip(data) {
  const n = data?.now;
  const air = data?.air;
  const aqi = Number(air?.aqi);
  if (n?.kind === 'storm') return { icon: 'CloudLightning', text: 'Thunderstorm around. Stay indoors and unplug what you can.' };
  if (n?.kind === 'rain' && n.level >= 0.9) return { icon: 'Umbrella', text: n.dryAt ? `Heavy rain. It should ease around ${IST_HOUR(n.dryAt)}.` : 'Heavy rain. Leave a little early and go slow on the roads.' };
  if (aqi > 300) return { icon: 'Haze', text: `Air is ${air.label.toLowerCase()}. Wear a mask outdoors and keep windows shut.` };
  if (n?.kind === 'rain' || n?.kind === 'drizzle') return { icon: 'Umbrella', text: n.dryAt ? `Rain outside. Should stop around ${IST_HOUR(n.dryAt)}.` : 'Rain outside. Keep an umbrella handy.' };
  if (n?.kind === 'fog') return { icon: 'CloudFog', text: 'Foggy outside. Drive slowly with low beams on.' };
  if (n?.kind === 'snow') return { icon: 'Snowflake', text: 'Snow outside. Wrap up warm.' };
  if (n?.rainAt) return { icon: 'Umbrella', text: `Rain likely around ${IST_HOUR(n.rainAt)}. Carry an umbrella.` };
  if (aqi > 200) return { icon: 'Haze', text: 'Air is poor. A mask helps if you are outside for long.' };
  if (Number(n?.feels) >= 38) return { icon: 'Thermometer', text: `Feels like ${n.feels}°C. Drink water and stay in the shade.` };
  if (Number(n?.feels) <= 12 && n?.feels !== null && n?.feels !== undefined) return { icon: 'Thermometer', text: 'Chilly out there. Wear something warm.' };
  if (Number(n?.wind) >= 35) return { icon: 'Wind', text: `Windy: ${n.wind} km/h. Hold on to your papers.` };
  if (aqi > 100) return { icon: 'Leaf', text: 'Air is moderate. Fine for most people.' };
  if (n && (n.kind === 'clear' || n.kind === 'partly')) return { icon: n.isDay === false ? 'Moon' : 'Sun', text: n.isDay === false ? 'A clear night outside.' : 'Lovely weather outside.' };
  return null;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const windFrom = (deg) => (Number.isFinite(Number(deg)) && deg !== null ? COMPASS[Math.round(((Number(deg) % 360) + 360) % 360 / 45) % 8] : '');

export function updatedAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (!Number.isFinite(mins)) return '';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}
