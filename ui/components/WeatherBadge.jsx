import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { AQI_COLORS, refreshWeather, updatedAgo, useWeather, weatherIcon, weatherTip, windFrom } from '../utils/weather.js';
import '../styles/weather.css';

// India AQI bands across the 0–500 bar (they are not all the same width).
const BAR = [['good', 50], ['satisfactory', 100], ['moderate', 200], ['poor', 300], ['very-poor', 400], ['severe', 500]];
const barGradient = `linear-gradient(90deg, ${BAR.map(([k, top], i) => {
  const from = i === 0 ? 0 : (BAR[i - 1][1] / 500) * 100;
  return `${AQI_COLORS[k]} ${from}% ${(top / 500) * 100}%`;
}).join(', ')})`;

function AqiPill({ air, compact }) {
  if (!air) return null;
  return (
    <span className="wx-aqi" style={{ '--aqi': AQI_COLORS[air.key] || '#8C9DAB' }}>
      <i aria-hidden="true" />
      <span className="wx-aqi-label">AQI</span>
      <b>{air.aqi}</b>
      {!compact && <small>{air.label}</small>}
    </span>
  );
}

/** The panel that opens from the card or chip. Rendered on the page body so no banner clips it. */
function Details({ data, anchor, onClose, id, askable, blocked }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [asking, setAsking] = useState(false);
  const n = data.now;
  const air = data.air;
  const tip = weatherTip(data);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(340, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = r.bottom + 8;
      const height = ref.current?.offsetHeight || 380;
      const top = below + height > window.innerHeight - 8 && r.top - height - 8 > 8 ? r.top - height - 8 : below;
      setPos({ left, top, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { onClose(); anchor.current?.focus(); } };
    const onDown = (e) => { if (!ref.current?.contains(e.target) && !anchor.current?.contains(e.target)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [anchor, onClose]);

  const useMine = async () => {
    setAsking(true);
    await refreshWeather({ force: true, askLocation: true });
    setAsking(false);
  };

  return createPortal(
    <section ref={ref} id={id} className="wx-details" role="dialog" aria-label="Weather and air quality" style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden' }}>
      {n && (
        <header className="wx-d-head">
          <span className={`wx-d-icon wx-anim-${n.kind}`}><Icon name={weatherIcon(n)} size={28} /></span>
          <div>
            <b>{n.temp}°C <small>{n.label}</small></b>
            <span>Feels like {n.feels}°C{Number.isFinite(n.high) && Number.isFinite(n.low) ? ` · Today ${n.low}° to ${n.high}°` : ''}</span>
          </div>
        </header>
      )}
      {n && (
        <ul className="wx-d-facts">
          <li><Icon name="Droplets" size={14} /> Humidity <b>{n.humidity}%</b></li>
          <li><Icon name="Wind" size={14} /> Wind <b>{n.wind} km/h</b>{windFrom(n.windDir) ? ` from the ${windFrom(n.windDir)}` : ''}</li>
          <li><Icon name="Umbrella" size={14} /> Rain in the next 3 hours <b>{n.rainChance ?? 0}%</b></li>
        </ul>
      )}
      {air && (
        <div className="wx-d-air">
          <div className="wx-d-air-top">
            <span>Air quality <small>{air.scale || 'India AQI'}</small></span>
            <b style={{ color: AQI_COLORS[air.key] }}>{air.aqi} <em>{air.label}</em></b>
          </div>
          <div className="wx-d-bar" style={{ background: barGradient }} role="img" aria-label={`AQI ${air.aqi} of 500`}>
            <i style={{ left: `${Math.min(100, (air.aqi / 500) * 100)}%` }} />
          </div>
          <p>{air.note}</p>
          <small className="wx-d-pm">Mostly {air.main}{Number.isFinite(air.pm25) ? ` · PM2.5 ${air.pm25}` : ''}{Number.isFinite(air.pm10) ? ` · PM10 ${air.pm10}` : ''} µg/m³ now</small>
        </div>
      )}
      {tip && <p className="wx-d-tip"><Icon name={tip.icon} size={14} /> {tip.text}</p>}
      <footer className="wx-d-foot">
        <span><Icon name="MapPin" size={12} /> {data.place || 'Office area'} · updated {updatedAgo(data.at)}</span>
        {askable && data.source !== 'device' && (
          <button type="button" onClick={useMine} disabled={asking}><Icon name={asking ? 'Loader2' : 'LocateFixed'} size={13} /> {asking ? 'Finding you…' : 'Use my location'}</button>
        )}
        {blocked && data.source !== 'device' && <small>Location is turned off for this site in your browser, so this is the weather at your workplace.</small>}
        <small>Weather by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · air from Copernicus CAMS</small>
      </footer>
    </section>,
    document.body
  );
}

/**
 * The live weather on the scenery.
 *  variant="card": temperature, sky, AQI and a tip (home greeting).
 *  variant="chip": one small line (page headers, sign-in pages).
 */
export default function WeatherBadge({ variant = 'chip', mode = 'auto', period, className = '' }) {
  const { data, askable, blocked } = useWeather({ mode });
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const id = `wx${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  if (!data || (!data.now && !data.air)) return null;
  const n = data.now;
  const tip = variant === 'card' ? weatherTip(data) : null;
  const label = [n ? `${n.temp}°C, ${n.label}` : '', data.air ? `AQI ${data.air.aqi}, ${data.air.label}` : ''].filter(Boolean).join('. ');

  return (
    <div className={`wx wx-${variant} ${className}`.trim()}>
      <button ref={anchor} type="button" className="wx-main" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`${label}. Show weather details`} title={`${label}. Click for details.`}>
        {n && <span className={`wx-icon wx-anim-${n.kind}`}><Icon name={weatherIcon(n, period)} size={variant === 'card' ? 22 : 15} /></span>}
        {n && <b className="wx-temp">{n.temp}°<small>C</small></b>}
        {n && variant === 'card' && (
          <span className="wx-sky"><b>{n.label}</b><small>Feels {n.feels}° · {data.place || 'Office area'}</small></span>
        )}
        <AqiPill air={data.air} compact={variant !== 'card'} />
      </button>
      {tip && <p className="wx-tip"><Icon name={tip.icon} size={13} /> {tip.text}</p>}
      {open && <Details data={data} anchor={anchor} onClose={() => setOpen(false)} id={id} askable={askable} blocked={blocked} />}
    </div>
  );
}
