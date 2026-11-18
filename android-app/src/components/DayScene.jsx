import React, { useEffect, useId, useMemo, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { istParts, todayKey as todayKeyOf } from '../utils/time';

/**
 * The website's time-of-day landscape (ui/components/DayScene.jsx), drawn with
 * react-native-svg: dawn sun behind the hills, bright midday, sunset, moon,
 * stars and fireflies (jugnu) at night, the JPK plant lit up after dark.
 * Colours blend minute by minute between key moments, using only the JPK
 * navy, orange and grey. Same maths as the website, so both look the same.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const hex2rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = (c) => `#${c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => { const x = hex2rgb(a); const y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
const luminance = (h) => {
  const [r, g, b] = hex2rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const f1 = (n) => Math.round(n * 10) / 10;

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ---------------------------------------------------------------- clock
// Preview another time of day (web build): ?sceneAt=18:30
function forcedMinutes() {
  try {
    if (typeof window === 'undefined' || !window.location || !window.location.search) return null;
    const q = new URLSearchParams(window.location.search).get('sceneAt');
    const m = String(q || '').match(/^(\d{1,2}):?(\d{2})$/);
    if (m) return (Number(m[1]) % 24) * 60 + Math.min(59, Number(m[2]));
  } catch { /* ignore */ }
  return null;
}

/** Minutes after midnight, India time (or the ?sceneAt= preview time). */
export function sceneMinutes(date = new Date()) {
  const forced = forcedMinutes();
  if (forced !== null) return forced;
  const p = istParts(date);
  return p.hours * 60 + p.minutes;
}

// Where the sun times are worked out for. Kolkata by default; set
// NEXT_PUBLIC_SCENE_LAT / NEXT_PUBLIC_SCENE_LNG for another site.
const SITE = {
  lat: Number(process.env.EXPO_PUBLIC_SCENE_LAT) || 22.57,
  lng: Number(process.env.EXPO_PUBLIC_SCENE_LNG) || 88.36,
};

/** Sunrise, solar noon and sunset for the day, in minutes after midnight IST. */
export function sunTimes(date = new Date(), site = SITE) {
  const p = istParts(date);
  const dayOfYear = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 1)) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const lat = (site.lat * Math.PI) / 180;
  const cosH = (Math.cos((90.833 * Math.PI) / 180) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const half = (Math.acos(clamp(cosH, -1, 1)) * 180) / Math.PI * 4; // minutes from noon to sunset
  const noon = 720 - 4 * site.lng - eqTime + 330;
  return { rise: noon - half, noon, set: noon + half };
}

export function periodFor(m, t = sunTimes()) {
  if (m >= t.rise - 75 && m < t.rise + 40) return 'dawn';
  if (m >= t.rise + 40 && m < 660) return 'morning';
  if (m >= 660 && m < 900) return 'midday';
  if (m >= 900 && m < t.set - 30) return 'afternoon';
  if (m >= t.set - 30 && m < t.set + 100) return 'evening';
  return 'night';
}

export function greetingAt(m) {
  if (m < 240) return 'Good night';
  if (m < 720) return 'Good morning';
  if (m < 1020) return 'Good afternoon';
  return 'Good evening';
}

const LINES = {
  dawn: 'An early start. The sun is just coming up.',
  morning: 'Have a great day ahead.',
  midday: 'Hope your day is going well.',
  afternoon: 'Keep going, you are doing great.',
  evening: 'The sun is setting. Hope the day went well.',
  night: 'Working late? Take care and rest well.',
};
export function periodLine(period, minutes, times) {
  if (period === 'evening' && times && minutes > times.set + 20) return 'Evening is here. Hope the day went well.';
  if (period === 'evening' && times && minutes < times.set - 5) return 'The sun will set soon. Hope the day went well.';
  return LINES[period] || '';
}
export const PERIOD_ICON = { dawn: 'Sunrise', morning: 'Sun', midday: 'Sun', afternoon: 'Sun', evening: 'Sunset', night: 'Moon' };

const PALETTES = {
  night: { sky: ['#0D1822', '#132230', '#1A2C3B', '#243748'], glow: ['#C3CDD6', 0.22], far: '#1E3142', mid: '#182939', plant: '#14232F', near: '#101C27', haze: ['#3E5568', 0.16], cloud: ['#2C4459', 0.34], stars: 1, lights: 1, flies: 1, birds: 0 },
  dawn: { sky: ['#22384B', '#5D7284', '#E9BE9A', '#F8B57D'], glow: ['#FBD3B0', 0.9], far: '#8C9DAB', mid: '#5D7284', plant: '#3E5568', near: '#2C4459', haze: ['#FDE7D4', 0.42], cloud: ['#FDE7D4', 0.8], stars: 0.25, lights: 0.75, flies: 0, birds: 1 },
  early: { sky: ['#8C9DAB', '#BAC6D1', '#EFE2D6', '#FDE7D4'], glow: ['#FEF4EA', 0.95], far: '#B9C5CF', mid: '#93A3B1', plant: '#5D7284', near: '#465B6E', haze: ['#FEF4EA', 0.5], cloud: ['#FFFFFF', 0.92], stars: 0, lights: 0.1, flies: 0, birds: 1 },
  morning: { sky: ['#869DB2', '#BCCAD6', '#E2E9EF', '#F6F8FA'], glow: ['#FFFFFF', 0.9], far: '#CAD3DB', mid: '#9AAAB7', plant: '#61768A', near: '#4E6377', haze: ['#FFFFFF', 0.45], cloud: ['#FFFFFF', 1], stars: 0, lights: 0, flies: 0, birds: 1 },
  midday: { sky: ['#6F88A0', '#A2B5C6', '#D5DFE8', '#F1F5F8'], glow: ['#FFFFFF', 1], far: '#CDD5DD', mid: '#9DACB9', plant: '#62778A', near: '#52677A', haze: ['#FFFFFF', 0.5], cloud: ['#FFFFFF', 1], stars: 0, lights: 0, flies: 0, birds: 0.5 },
  afternoon: { sky: ['#8299AE', '#B5C4D1', '#E3E6EA', '#FAEEE3'], glow: ['#FEF4EA', 0.9], far: '#C1CBD4', mid: '#91A0AE', plant: '#5D7284', near: '#4A5F72', haze: ['#FEF4EA', 0.45], cloud: ['#FFFFFF', 0.95], stars: 0, lights: 0, flies: 0, birds: 1 },
  late: { sky: ['#5D7284', '#9AA9B7', '#F2CFAF', '#FBD3B0'], glow: ['#FBD3B0', 0.95], far: '#97A6B3', mid: '#66798A', plant: '#465B6D', near: '#2C4459', haze: ['#FDE7D4', 0.45], cloud: ['#FEF4EA', 0.85], stars: 0, lights: 0.25, flies: 0, birds: 1 },
  sunset: { sky: ['#1F3445', '#55697B', '#EE9A57', '#F38121'], glow: ['#F8B57D', 0.95], far: '#5D7284', mid: '#3E5568', plant: '#2C4459', near: '#1F3445', haze: ['#F8B57D', 0.32], cloud: ['#FBD3B0', 0.72], stars: 0.15, lights: 0.9, flies: 0.4, birds: 1 },
  dusk: { sky: ['#132230', '#1F3445', '#3B4F62', '#8E4F1D'], glow: ['#C3CDD6', 0.25], far: '#2A3F52', mid: '#1F3445', plant: '#182A38', near: '#132230', haze: ['#5D7284', 0.2], cloud: ['#3E5568', 0.12], stars: 0.75, lights: 1, flies: 1, birds: 0 },
};

// Key moments of the day, placed around the real sunrise and sunset.
function keysFor(t) {
  return [[0, 'night'], [t.rise - 80, 'night'], [t.rise - 12, 'dawn'], [t.rise + 50, 'early'], [t.rise + 170, 'morning'], [t.noon, 'midday'],
    [t.set - 150, 'afternoon'], [t.set - 60, 'late'], [t.set + 2, 'sunset'], [t.set + 45, 'dusk'], [t.set + 100, 'night'], [1440, 'night']];
}

function blend(a, b, t) {
  const out = {};
  Object.keys(a).forEach((key) => {
    const va = a[key];
    const vb = b[key];
    if (typeof va === 'number') out[key] = lerp(va, vb, t);
    else if (typeof va === 'string') out[key] = mix(va, vb, t);
    else out[key] = va.map((v, i) => (typeof v === 'number' ? lerp(v, vb[i], t) : mix(v, vb[i], t)));
  });
  return out;
}

export function paletteAt(m, t = sunTimes()) {
  const keys = keysFor(t);
  for (let i = 0; i < keys.length - 1; i += 1) {
    const [t0, a] = keys[i];
    const [t1, b] = keys[i + 1];
    if (m >= t0 && m <= t1) return blend(PALETTES[a], PALETTES[b], smooth(0, 1, (m - t0) / (t1 - t0 || 1)));
  }
  return PALETTES.night;
}

/** 'dark' when white text reads better on the upper sky, otherwise 'light'. */
function toneFor(pal) {
  const l = luminance(mix(pal.sky[0], pal.sky[1], 0.65));
  const onWhite = 1.05 / (l + 0.05);
  const onNavy = (l + 0.05) / (luminance('#1F3445') + 0.05);
  return onWhite > onNavy ? 'dark' : 'light';
}

// ---------------------------------------------------------------- shapes
function smoothPath(pts, bottom) {
  let d = `M${f1(pts[0][0])} ${f1(bottom)} L${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return `${d} L${f1(pts[pts.length - 1][0])} ${f1(bottom)} Z`;
}

function yAt(pts, x) {
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (x >= pts[i][0] && x <= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0]));
  }
  return pts[pts.length - 1][1];
}

/** Everything that depends only on the box size: hills, plant, trees, stars… */
function buildGeometry(W, H, variant) {
  const band = variant === 'band';
  const rand = seeded(band ? 23 : 7);
  const narrow = W / H < 2.6;
  const k = clamp(H / 240, 0.34, 1.2);
  const kw = clamp(Math.min(k, W / 1150 + 0.08), 0.3, 1.1); // plant & trees stay in proportion on phones
  const step = Math.max(k, 0.6);
  const horizon = H * (band ? 0.8 : narrow ? 0.76 : 0.7);
  // Keep the left side low and quiet: that is where the title or greeting sits.
  const calm = (x) => {
    if (band) return 0.3 + 0.7 * smooth(W * 0.3, W * 0.62, x);
    if (narrow) return 0.55 + 0.45 * smooth(W * 0.2, W * 0.75, x);
    return 0.45 + 0.55 * smooth(W * 0.12, W * 0.5, x);
  };

  // Ridge points from left of the box to right of it, ending exactly past the edge.
  const ridge = (from, to, gap, yFor) => {
    const pts = [];
    for (let x = from, i = 0; ; i += 1) {
      pts.push([x, yFor(x, i)]);
      if (x >= to) break;
      x = Math.min(to, x + gap());
    }
    return pts;
  };
  const far = ridge(-40, W + 60, () => (64 + rand() * 90) * step, (x, i) => horizon - 4 * k - (i % 2 === 0 ? 0.55 + rand() * 0.45 : rand() * 0.22) * 62 * k * calm(x));

  const plantW = 300 * kw;
  const plantX = band ? W * 0.7 : narrow ? W * 0.5 : W * 0.64;
  const plantBase = horizon + 7 * k;
  const plateau = [plantX - 70 * kw, plantX + plantW + 70 * kw];
  const mid = ridge(-60, W + 80, () => (190 + rand() * 150) * step, (x) => horizon + 12 * k - rand() * 24 * k * calm(x))
    .filter(([x]) => x < plateau[0] || x > plateau[1]);
  for (let x = plantX - 40 * kw; x <= plantX + plantW + 40 * kw; x += 55 * kw) mid.push([x, plantBase]);
  mid.sort((a, b) => a[0] - b[0]);

  const nearY = H * (band ? 0.95 : narrow ? 0.92 : 0.87);
  const near = ridge(-60, W + 80, () => (230 + rand() * 210) * step, () => nearY - rand() * 15 * k);

  const trees = [];
  const cluster = (cx, n, spread) => {
    for (let i = 0; i < n; i += 1) {
      const x = cx + (rand() - 0.5) * spread;
      const h = (24 + rand() * 30) * kw;
      trees.push({ x, base: yAt(near, x) + 8 * kw, h, pine: rand() < 0.4 });
    }
  };
  if (band) { cluster(W * 0.6, 3, 70 * kw); cluster(W * 0.94, 5, 110 * kw); }
  else if (narrow) { cluster(W * 0.1, 3, 60 * kw); cluster(W * 0.9, 4, 80 * kw); }
  else { cluster(W * 0.36, 3, 80 * kw); cluster(W * 0.55, 2, 50 * kw); cluster(W * 0.93, 6, 140 * kw); }
  trees.sort((a, b) => a.h - b.h);

  const stars = Array.from({ length: Math.round((W * H) / (band ? 2600 : 4000)) }, () => ({
    x: rand() * W, y: rand() * horizon * 0.86, r: (0.45 + rand() * 1.05) * Math.max(0.8, k), tw: rand() < 0.35, d: rand() * 5, dur: 2.4 + rand() * 3,
  }));

  const clouds = Array.from({ length: clamp(Math.round(W / 380), 2, 5) }, () => ({
    y: H * (0.14 + rand() * 0.3), s: (0.5 + rand() * 0.55) * k, dur: 160 + rand() * 140, d: -(rand() * 300),
  }));

  const flocks = [0, 1].map((i) => ({ y: H * (0.2 + rand() * 0.18) + i * 10 * k, s: kw * (i ? 0.8 : 1), dur: 46 + rand() * 30, d: -(rand() * 60) - i * 25 }));

  const flyRange = band ? [W * 0.46, W * 0.99] : [W * 0.02, W * 0.98];
  const flies = Array.from({ length: band ? 16 : narrow ? 14 : 28 }, () => ({
    x: lerp(flyRange[0], flyRange[1], rand()), y: horizon + rand() * (H - horizon - 6), d: rand() * 5, dur: 2.2 + rand() * 2.6, path: 'abc'[Math.floor(rand() * 3)], mdur: 7 + rand() * 7,
  }));

  const arc = band
    ? { x0: W * 0.5, x1: W * 0.97, top: H * 0.26, base: horizon }
    : narrow ? { x0: W * 0.5, x1: W * 0.95, top: H * 0.56, base: horizon } : { x0: W * 0.38, x1: W * 0.96, top: H * 0.16, base: horizon };

  return {
    W, H, k, kw, horizon, arc, plantX, plantBase, plantW, band,
    skyStops: band ? [0.5, 0.9] : [0.45, 0.8],
    farPath: smoothPath(far, H), midPath: smoothPath(mid, H), nearPath: smoothPath(near, H),
    trees, stars, clouds, flocks, flies,
    sunR: Math.max(band ? 9 : 12, 20 * k), moonR: Math.max(band ? 7 : 10, 15 * k),
  };
}


/** Re-renders on the minute, and when the app comes back to the front. */
export function useSceneClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 60000);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  return now;
}

// ---------------------------------------------------------------- pieces
function Cloud({ c, W, fill, opacity, index }) {
  const w = 140 * c.s;
  // Clouds sit still on the phone; spread them over the right part of the sky
  // (greetings and names are written on the left) instead of drifting.
  const slot = (index * 0.37 + 0.12) % 1;
  const x = W * (0.64 + slot * 0.3) - w * 0.35;
  return (
    <G transform={`translate(${f1(x)} ${f1(c.y)}) scale(${f1(c.s * 100) / 100})`} fill={fill} opacity={opacity}>
      <Ellipse cx="70" cy="0" rx="62" ry="14" />
      <Ellipse cx="44" cy="-8" rx="28" ry="16" />
      <Ellipse cx="78" cy="-17" rx="32" ry="21" />
      <Ellipse cx="106" cy="-6" rx="24" ry="13" />
    </G>
  );
}

function Flock({ f, W, color, opacity, index }) {
  const bird = (dx, dy, k) => (
    <Path key={`${dx}`} d={`M${dx - 6 * k} ${dy} Q${dx - 3 * k} ${dy - 4 * k} ${dx} ${dy} Q${dx + 3 * k} ${dy - 4 * k} ${dx + 6 * k} ${dy}`}
      fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  );
  const x = W * (index ? 0.3 : 0.52);
  return (
    <G opacity={opacity} transform={`translate(${f1(x)} ${f1(f.y)}) scale(${f1(f.s * 100) / 100})`}>
      {bird(0, 0, 1)}{bird(17, -7, 0.85)}{bird(33, 3, 0.9)}{bird(48, -4, 0.75)}
    </G>
  );
}

function Plant({ x, base, k, fill, windowDay, lights }) {
  const u = (n) => f1(n * k);
  const lit = lights > 0.02;
  const win = (wx, wy, i) => (
    <Rect key={`${wx}-${wy}`} x={f1(x + wx * k)} y={f1(base - wy * k)} width={u(6)} height={u(5)} rx={u(0.8)}
      fill={lit && i % 5 !== 3 ? '#F8B57D' : windowDay}
      opacity={lit && i % 5 !== 3 ? clamp(lights, 0.35, 1) : 0.55} />
  );
  const shedWindows = [16, 30, 52, 66, 88, 102, 124].map((wx, i) => win(wx, 22, i));
  const officeWindows = [];
  [0, 1, 2].forEach((r) => [0, 1, 2, 3].forEach((c) => officeWindows.push(win(196 + c * 13, 50 - r * 13, 10 + r * 4 + c))));
  return (
    <G>
      <Path fill={fill} d={`M${f1(x)} ${f1(base + 6 * k)} V${f1(base - 34 * k)} l${u(36)} ${u(-16)} v${u(16)} l${u(36)} ${u(-16)} v${u(16)} l${u(36)} ${u(-16)} v${u(16)} l${u(36)} ${u(-16)} V${f1(base + 6 * k)} Z`} />
      <Rect x={f1(x + 150 * k)} y={f1(base - 116 * k)} width={u(12)} height={u(122)} fill={fill} />
      <Rect x={f1(x + 147 * k)} y={f1(base - 120 * k)} width={u(18)} height={u(6)} rx={u(1)} fill={fill} />
      <Rect x={f1(x + 150 * k)} y={f1(base - 100 * k)} width={u(12)} height={u(3)} fill={windowDay} opacity="0.35" />
      <Rect x={f1(x + 188 * k)} y={f1(base - 60 * k)} width={u(62)} height={u(66)} fill={fill} />
      <Rect x={f1(x + 262 * k)} y={f1(base - 52 * k)} width={u(22)} height={u(58)} rx={u(3)} fill={fill} />
      <Rect x={f1(x + 288 * k)} y={f1(base - 64 * k)} width={u(22)} height={u(70)} rx={u(3)} fill={fill} />
      <Ellipse cx={f1(x + 273 * k)} cy={f1(base - 52 * k)} rx={u(11)} ry={u(4)} fill={fill} />
      <Ellipse cx={f1(x + 299 * k)} cy={f1(base - 64 * k)} rx={u(11)} ry={u(4)} fill={fill} />
      <Path d={`M${f1(x + 250 * k)} ${f1(base - 40 * k)} L${f1(x + 290 * k)} ${f1(base - 62 * k)}`} stroke={fill} strokeWidth={u(4)} strokeLinecap="round" />
      {shedWindows}
      {officeWindows}
      {lit && <Circle cx={f1(x + 156 * k)} cy={f1(base - 124 * k)} r={Math.max(1.4, 2.4 * k)} fill="#F38121" opacity={lights} />}
    </G>
  );
}

function Tree({ t, fill }) {
  const { x, base, h, pine } = t;
  if (pine) {
    return (
      <G fill={fill}>
        <Rect x={f1(x - h * 0.04)} y={f1(base - h * 0.3)} width={f1(h * 0.08)} height={f1(h * 0.3)} />
        <Path d={`M${f1(x)} ${f1(base - h)} L${f1(x + h * 0.26)} ${f1(base - h * 0.28)} L${f1(x - h * 0.26)} ${f1(base - h * 0.28)} Z`} />
      </G>
    );
  }
  return (
    <G fill={fill}>
      <Rect x={f1(x - h * 0.04)} y={f1(base - h * 0.45)} width={f1(h * 0.08)} height={f1(h * 0.45)} />
      <Ellipse cx={f1(x)} cy={f1(base - h * 0.66)} rx={f1(h * 0.3)} ry={f1(h * 0.36)} />
      <Ellipse cx={f1(x - h * 0.16)} cy={f1(base - h * 0.5)} rx={f1(h * 0.2)} ry={f1(h * 0.2)} />
      <Ellipse cx={f1(x + h * 0.17)} cy={f1(base - h * 0.52)} rx={f1(h * 0.2)} ry={f1(h * 0.19)} />
    </G>
  );
}

function SceneArt({ g, pal, m, times, uid }) {
  const { W, H, arc } = g;
  const s = (m - times.rise) / (times.set - times.rise);
  const alt = Math.sin(Math.PI * clamp(s, 0, 1));
  const sunUp = s > -0.07 && s < 1.07;
  const below = s < 0 ? -s : s > 1 ? s - 1 : 0;
  const sunX = lerp(arc.x0, arc.x1, clamp(s, -0.04, 1.04));
  const sunY = arc.base - alt * (arc.base - arc.top) + below * H * 3 + (1 - alt) * g.sunR * 0.4;
  const sunR = g.sunR * (1.12 - 0.12 * alt);
  const sunEdge = mix('#F38121', '#FDE7D4', smooth(0.08, 0.8, alt));
  const sunCore = mix('#F8B57D', '#FFFFFF', smooth(0.05, 0.6, alt));
  const rays = smooth(0.6, 0.92, alt);

  const moonRise = times.set - 140;
  const u = ((((m - moonRise) % 1440) + 1440) % 1440) / (1440 - moonRise + times.rise + 60);
  const moonUp = u >= 0 && u <= 1;
  const malt = Math.sin(Math.PI * clamp(u, 0, 1));
  const moonX = lerp(arc.x0 + (arc.x1 - arc.x0) * 0.06, arc.x1, u);
  const moonY = arc.base - malt * (arc.base - arc.top) * 0.96;
  const morningSun = s > -0.1 && s < 0.5 ? smooth(-0.1, -0.02, s) : 0;
  const moonShow = moonUp ? clamp(1 - luminance(pal.sky[1]) * 2.3, 0, 1) * smooth(0, 0.05, u) * (1 - smooth(0.95, 1, u)) * (1 - morningSun) : 0;
  const glowR = sunR * 6.5 * (1 + (1 - alt) * 0.6);

  const tone = toneFor(pal);
  const shade = tone === 'dark' ? { c: pal.sky[0], a: g.band ? 0.62 : 0.42 } : { c: '#FFFFFF', a: g.band ? 0.42 : 0.3 };
  const birdColor = mix(pal.near, pal.far, 0.25);
  const windowDay = mix(pal.plant, pal.far, 0.45);
  const smoke = mix(pal.far, '#FFFFFF', 0.35);
  const id = (name) => `${uid}${name}`;

  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id('sky')} x1="0" y1="0" x2="0" y2={g.horizon} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={pal.sky[0]} />
          <Stop offset={g.skyStops[0]} stopColor={pal.sky[1]} />
          <Stop offset={g.skyStops[1]} stopColor={pal.sky[2]} />
          <Stop offset="1" stopColor={pal.sky[3]} />
        </LinearGradient>
        <RadialGradient id={id('glow')} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={pal.glow[0]} stopOpacity={pal.glow[1]} />
          <Stop offset="0.3" stopColor={pal.glow[0]} stopOpacity={pal.glow[1] * 0.42} />
          <Stop offset="1" stopColor={pal.glow[0]} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={id('sun')} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={sunCore} />
          <Stop offset="0.7" stopColor={mix(sunCore, sunEdge, 0.6)} />
          <Stop offset="1" stopColor={sunEdge} />
        </RadialGradient>
        <RadialGradient id={id('halo')} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#E1E7EC" stopOpacity="0.34" />
          <Stop offset="0.22" stopColor="#E1E7EC" stopOpacity="0.14" />
          <Stop offset="1" stopColor="#E1E7EC" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={id('shadeX')} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={shade.c} stopOpacity={shade.a} />
          <Stop offset={g.band ? 0.3 : 0.26} stopColor={shade.c} stopOpacity={shade.a * 0.75} />
          <Stop offset={g.band ? 0.52 : 0.5} stopColor={shade.c} stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id={id('haze')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={pal.haze[0]} stopOpacity="0" />
          <Stop offset="0.6" stopColor={pal.haze[0]} stopOpacity={pal.haze[1]} />
          <Stop offset="1" stopColor={pal.haze[0]} stopOpacity="0" />
        </LinearGradient>
        <RadialGradient id={id('fly')} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFF7EC" />
          <Stop offset="0.3" stopColor="#FBD3B0" stopOpacity="0.9" />
          <Stop offset="1" stopColor="#F38121" stopOpacity="0" />
        </RadialGradient>
        <Mask id={id('moon')} x="0" y="0" width={W} height={H} maskUnits="userSpaceOnUse">
          <Rect x="0" y="0" width={W} height={H} fill="black" />
          <Circle cx={f1(moonX)} cy={f1(moonY)} r={g.moonR} fill="white" />
          <Circle cx={f1(moonX + g.moonR * 0.48)} cy={f1(moonY - g.moonR * 0.28)} r={g.moonR * 0.9} fill="black" />
        </Mask>
      </Defs>

      <Rect width={W} height={H} fill={`url(#${id('sky')})`} />

      {pal.stars > 0.02 && (
        <G opacity={f1(pal.stars * 100) / 100}>
          {g.stars.map((st, i) => <Circle key={i} cx={f1(st.x)} cy={f1(st.y)} r={f1(st.r)} fill="#FFFFFF" opacity={st.tw ? 0.6 : 0.95} />)}
        </G>
      )}

      {sunUp && <Circle cx={f1(sunX)} cy={f1(sunY)} r={f1(glowR)} fill={`url(#${id('glow')})`} />}

      {moonShow > 0.02 && (
        <G opacity={f1(moonShow * 100) / 100}>
          <Circle cx={f1(moonX)} cy={f1(moonY)} r={f1(g.moonR * 5.5)} fill={`url(#${id('halo')})`} />
          <Circle cx={f1(moonX)} cy={f1(moonY)} r={g.moonR} fill="#E1E7EC" opacity="0.1" />
          <Rect x="0" y="0" width={W} height={H} fill="#F7F7F8" mask={`url(#${id('moon')})`} />
        </G>
      )}

      {sunUp && (
        <G>
          {rays > 0.02 && (
            <G opacity={f1(rays * 45) / 100}>
              {Array.from({ length: 12 }, (_, i) => {
                const a = (i / 12) * Math.PI * 2;
                const r1 = sunR * 1.45;
                const r2 = sunR * (i % 2 ? 2.05 : 2.45);
                const w = 0.07;
                return <Path key={i} fill="#FFFFFF" d={`M${f1(sunX + Math.cos(a - w) * r1)} ${f1(sunY + Math.sin(a - w) * r1)} L${f1(sunX + Math.cos(a) * r2)} ${f1(sunY + Math.sin(a) * r2)} L${f1(sunX + Math.cos(a + w) * r1)} ${f1(sunY + Math.sin(a + w) * r1)} Z`} />;
              })}
            </G>
          )}
          <Circle cx={f1(sunX)} cy={f1(sunY)} r={f1(sunR * 1.25)} fill={sunCore} opacity={f1(0.25 + alt * 0.2)} />
          <Circle cx={f1(sunX)} cy={f1(sunY)} r={f1(sunR)} fill={`url(#${id('sun')})`} />
        </G>
      )}

      {g.clouds.map((c, i) => <Cloud key={i} index={i} c={c} W={W} fill={pal.cloud[0]} opacity={f1(pal.cloud[1] * 100) / 100} />)}
      {pal.birds > 0.05 && g.flocks.map((f, i) => <Flock key={i} index={i} f={f} W={W} color={birdColor} opacity={f1(pal.birds * 90) / 100} />)}

      <Path d={g.farPath} fill={pal.far} />
      <Rect x="0" y={f1(g.horizon - 34 * g.k)} width={W} height={f1(48 * g.k)} fill={`url(#${id('haze')})`} />
      <Rect width={W} height={f1(g.horizon)} fill={`url(#${id('shadeX')})`} />

      <Plant x={g.plantX} base={g.plantBase} k={g.kw} fill={pal.plant} windowDay={windowDay} lights={pal.lights} />
      <G fill={smoke}>
        {[0, 1, 2].map((i) => (
          <Circle key={i} cx={f1(g.plantX + (156 + i * 9) * g.kw)} cy={f1(g.plantBase - (124 + i * 13) * g.kw)} r={f1(Math.max(3, (5 + i * 1.6) * g.kw))} opacity={0.42 - i * 0.12} />
        ))}
      </G>

      <Path d={g.midPath} fill={pal.mid} />
      {g.trees.map((t, i) => <Tree key={i} t={t} fill={pal.near} />)}
      <Path d={g.nearPath} fill={pal.near} />

      {pal.flies > 0.03 && (
        <G opacity={f1(pal.flies * 100) / 100}>
          {g.flies.map((fl, i) => (
            <G key={i}>
              <Circle cx={f1(fl.x)} cy={f1(fl.y)} r={f1(Math.max(5, 9 * g.k))} fill={`url(#${id('fly')})`} opacity={i % 3 === 0 ? 0.55 : 0.9} />
              <Circle cx={f1(fl.x)} cy={f1(fl.y)} r={f1(Math.max(1.1, 1.7 * g.k))} fill="#FFF7EC" />
            </G>
          ))}
        </G>
      )}
    </Svg>
  );
}

/**
 * <DayScene variant="hero" style={{ height: 180 }}>{({ tone }) => …}</DayScene>
 * Draws the scene behind its children. Children may be a function that gets
 * { period, tone, minutes }: tone 'dark' means white text reads best.
 */
export default function DayScene({ variant = 'hero', style, children }) {
  const [size, setSize] = useState(null);
  const uid = `sc${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const now = useSceneClock();
  const minutes = sceneMinutes(now);
  const day = todayKeyOf(now);
  const times = useMemo(() => sunTimes(new Date(`${day}T12:00:00+05:30`)), [day]);
  const pal = useMemo(() => paletteAt(minutes, times), [minutes, times]);
  const geo = useMemo(() => (size ? buildGeometry(size.w, size.h, variant) : null), [size, variant]);
  const period = periodFor(minutes, times);
  const tone = toneFor(pal);
  const content = typeof children === 'function' ? children({ period, tone, minutes, times }) : children;

  return (
    <View
      style={[{ overflow: 'hidden', backgroundColor: pal.sky[1] }, style]}
      onLayout={(e) => {
        const w = Math.max(1, Math.round(e.nativeEvent.layout.width));
        const h = Math.max(1, Math.round(e.nativeEvent.layout.height));
        setSize((old) => (old && old.w === w && old.h === h ? old : { w, h }));
      }}
    >
      {geo && <SceneArt g={geo} pal={pal} m={minutes} times={times} uid={uid} />}
      {content}
    </View>
  );
}

export { toneFor };
