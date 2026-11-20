import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { todayKey, istParts } from '../utils/time.js';
import '../styles/pickers.css';

/*
 * Date and time without typing: a calendar for the date and a clock for the
 * time. Values stay in the formats the screens already send to the server:
 *   DatePicker      "YYYY-MM-DD"
 *   TimePicker      "HH:mm" (24 h, India time)
 *   DateTimeField   "YYYY-MM-DDTHH:mm" (India time, no zone; istInputToIso adds +05:30)
 * The popovers are drawn on top of the page, so a scrolling drawer never cuts
 * them off; on a phone they open as a sheet from the bottom.
 */

const pad = (n) => String(n).padStart(2, '0');
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
const keyOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function addDays(key, days) {
  const p = parseKey(key);
  if (!p) return key;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
function dayLabel(key, options) {
  const p = parseKey(key);
  if (!p) return '';
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
  if (options) return date.toLocaleDateString('en-IN', { timeZone: 'UTC', ...options });
  // Button text: "Wed, 4 Nov" (the year only when it is not this year).
  const part = (o) => date.toLocaleDateString('en-IN', { timeZone: 'UTC', ...o });
  const year = p.y !== Number(todayKey().slice(0, 4)) ? ` ${p.y}` : '';
  return `${part({ weekday: 'short' })}, ${p.d} ${part({ month: 'short' })}${year}`;
}
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const hhmmOf = (minutes) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
export function timeLabel(hhmm) {
  const mins = minutesOf(hhmm);
  if (mins === null) return '';
  const h = Math.floor(mins / 60);
  return `${((h + 11) % 12) + 1}:${pad(mins % 60)} ${h >= 12 ? 'pm' : 'am'}`;
}

/** A panel anchored to its button, drawn at the top of the page (fixed), flipped up when there is no room below. */
function Popover({ anchorRef, open, onClose, label, width = 304, children }) {
  const panelRef = useRef(null);
  const [place, setPlace] = useState(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function position() {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (vw < 560) { setPlace({ sheet: true }); return; }
      const height = panelRef.current?.offsetHeight || 380;
      const below = vh - anchor.bottom;
      const top = below >= height + 12 || below >= anchor.top ? anchor.bottom + 6 : Math.max(8, anchor.top - height - 6);
      const left = Math.min(Math.max(8, anchor.left), vw - width - 8);
      setPlace({ top: Math.min(top, Math.max(8, vh - height - 8)), left });
    }
    position();
    const raf = requestAnimationFrame(position);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, anchorRef, width]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (panelRef.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    // Escape closes only the picker, not the drawer it sits in.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === 'undefined') return null;
  const style = place && !place.sheet ? { top: place.top, left: place.left, width } : (place ? undefined : { visibility: 'hidden', top: 0, left: 0, width });
  return createPortal(
    <>
      {place?.sheet && <div className="dtp-scrim" onClick={onClose} aria-hidden="true" />}
      <div ref={panelRef} role="dialog" aria-label={label} className={`dtp-pop${place?.sheet ? ' is-sheet' : ''}`} style={style}>
        {children}
      </div>
    </>,
    document.body
  );
}

/* ------------------------------------------------------------------ date */

export function DatePicker({ value, onChange, min, max, label = 'Date', disabled = false, placeholder = 'Pick a date', id }) {
  const anchorRef = useRef(null);
  const gridRef = useRef(null);
  const [open, setOpen] = useState(false);
  const today = todayKey();
  const selected = parseKey(value);
  const start = selected || parseKey(today);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [focusKey, setFocusKey] = useState(value || today);
  const autoId = useId();

  useEffect(() => {
    if (!open) return;
    const p = parseKey(value) || parseKey(today);
    setView({ y: p.y, m: p.m });
    setFocusKey(value || today);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => gridRef.current?.querySelector(`[data-key="${focusKey}"]`)?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, focusKey, view]);

  const outOfRange = (key) => (min && key < min) || (max && key > max);
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(view.y, view.m - 1, 1));
    const lead = first.getUTCDay();
    const out = [];
    for (let i = 0; i < 42; i += 1) {
      const dt = new Date(Date.UTC(view.y, view.m - 1, 1 - lead + i));
      out.push({ key: keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()), day: dt.getUTCDate(), inMonth: dt.getUTCMonth() + 1 === view.m });
    }
    // Drop a trailing week that is entirely next month.
    return out.slice(35).every((c) => !c.inMonth) ? out.slice(0, 35) : out;
  }, [view]);

  function moveMonth(delta) {
    const dt = new Date(Date.UTC(view.y, view.m - 1 + delta, 1));
    setView({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1 });
  }
  function pick(key) {
    if (outOfRange(key)) return;
    onChange?.(key);
    setOpen(false);
    anchorRef.current?.focus();
  }
  function onGridKey(e) {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (steps[e.key] !== undefined) {
      e.preventDefault();
      const next = addDays(focusKey, steps[e.key]);
      const p = parseKey(next);
      if (p.m !== view.m || p.y !== view.y) setView({ y: p.y, m: p.m });
      setFocusKey(next);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      moveMonth(e.key === 'PageUp' ? -1 : 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(focusKey);
    }
  }

  const monthTitle = new Date(Date.UTC(view.y, view.m - 1, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const lastOfPrev = new Date(Date.UTC(view.y, view.m - 1, 0));
  const firstOfNext = new Date(Date.UTC(view.y, view.m, 1));
  const prevDisabled = Boolean(min && keyOf(lastOfPrev.getUTCFullYear(), lastOfPrev.getUTCMonth() + 1, lastOfPrev.getUTCDate()) < min);
  const nextDisabled = Boolean(max && keyOf(firstOfNext.getUTCFullYear(), firstOfNext.getUTCMonth() + 1, 1) > max);

  return (
    <>
      <button
        type="button"
        id={id || autoId}
        ref={anchorRef}
        className={`dtp-trigger${value ? '' : ' is-empty'}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value ? dayLabel(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'not chosen'}. Open calendar`}
      >
        <Icon name="CalendarDays" size={16} />
        <span>{value ? dayLabel(value) : placeholder}</span>
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label={`${label} calendar`} width={300}>
        <div className="dtp-cal">
          <div className="dtp-cal-head">
            <button type="button" className="dtp-nav" onClick={() => moveMonth(-1)} disabled={prevDisabled} aria-label="Previous month"><Icon name="ChevronLeft" size={16} /></button>
            <b aria-live="polite">{monthTitle}</b>
            <button type="button" className="dtp-nav" onClick={() => moveMonth(1)} disabled={nextDisabled} aria-label="Next month"><Icon name="ChevronRight" size={16} /></button>
          </div>
          <div className="dtp-cal-grid" role="grid" ref={gridRef} onKeyDown={onGridKey}>
            {WEEKDAYS.map((w) => <span key={w} className="dtp-wd" role="columnheader">{w}</span>)}
            {cells.map((c) => {
              const isSel = c.key === value;
              const blocked = outOfRange(c.key);
              return (
                <button
                  type="button"
                  key={c.key}
                  data-key={c.key}
                  role="gridcell"
                  tabIndex={c.key === focusKey ? 0 : -1}
                  className={`dtp-day${c.inMonth ? '' : ' is-out'}${isSel ? ' is-selected' : ''}${c.key === today ? ' is-today' : ''}`}
                  disabled={blocked}
                  aria-selected={isSel}
                  aria-label={dayLabel(c.key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  onClick={() => pick(c.key)}
                >{c.day}</button>
              );
            })}
          </div>
          <div className="dtp-foot">
            <button type="button" className="dtp-chip" onClick={() => pick(today)} disabled={outOfRange(today)}>Today</button>
            {min && max && addDays(min, 1) === max && (
              <>
                <button type="button" className="dtp-chip" onClick={() => pick(min)}>{dayLabel(min, { day: 'numeric', month: 'short' })}</button>
                <button type="button" className="dtp-chip" onClick={() => pick(max)}>Next day</button>
              </>
            )}
            <button type="button" className="dtp-done" onClick={() => { setOpen(false); anchorRef.current?.focus(); }}>Close</button>
          </div>
        </div>
      </Popover>
    </>
  );
}

/* ------------------------------------------------------------------ time */

const HOUR_MARKS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTE_MARKS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function ClockDial({ mode, minutes, onPick, onRelease }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const angle = mode === 'hour' ? (h24 % 12) * 30 : m * 6;

  function valueAt(e) {
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    let deg = (Math.atan2(x, -y) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return mode === 'hour' ? Math.round(deg / 30) % 12 : Math.round(deg / 6) % 60;
  }
  const down = (e) => {
    e.preventDefault();
    dragging.current = true;
    ref.current.setPointerCapture?.(e.pointerId);
    onPick(valueAt(e));
  };
  const move = (e) => { if (dragging.current) onPick(valueAt(e)); };
  const up = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    ref.current.releasePointerCapture?.(e.pointerId);
    onRelease?.();
  };

  const marks = mode === 'hour' ? HOUR_MARKS : MINUTE_MARKS;
  return (
    <div className="dtp-dial" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true">
      <span className="dtp-hand" style={{ transform: `rotate(${angle}deg)` }}><i /></span>
      <span className="dtp-center" />
      {marks.map((mark, i) => {
        const a = (mode === 'hour' ? i * 30 : mark * 6) * (Math.PI / 180);
        const active = mode === 'hour' ? (h24 % 12) === i : m === mark;
        return (
          <span
            key={mark}
            className={`dtp-mark${active ? ' is-active' : ''}`}
            style={{ left: `${50 + Math.sin(a) * 40}%`, top: `${50 - Math.cos(a) * 40}%` }}
          >{mode === 'hour' ? mark : pad(mark)}</span>
        );
      })}
    </div>
  );
}

export function TimePicker({ value, onChange, label = 'Time', disabled = false, placeholder = 'Pick a time', suggestions = [], defaultValue = '10:00', id }) {
  const anchorRef = useRef(null);
  const panelFocusRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('hour');
  const current = minutesOf(value);
  const minutes = current ?? minutesOf(defaultValue) ?? 600;
  const autoId = useId();

  useEffect(() => {
    if (!open) return undefined;
    setMode('hour');
    const t = setTimeout(() => panelFocusRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // The value changes live while the clock is used, so nothing is lost if the
  // picker is closed without pressing Done.
  const set = (next) => onChange?.(hhmmOf(((next % 1440) + 1440) % 1440));
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const pm = h24 >= 12;
  const pickHour = (h0to11) => set(((pm ? 12 : 0) + h0to11) * 60 + m);
  const pickMinute = (mm) => set(h24 * 60 + mm);
  const setPm = (wantPm) => { if (wantPm !== pm) set(minutes + (wantPm ? 720 : -720)); };

  function onPanelKey(e) {
    const step = mode === 'hour' ? 60 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); set(minutes + step); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); set(minutes - step); }
    else if (e.key === 'Enter') { e.preventDefault(); if (mode === 'hour') setMode('minute'); else { setOpen(false); anchorRef.current?.focus(); } }
  }

  const display12 = ((h24 + 11) % 12) + 1;
  const nowIst = (() => { const p = istParts(); return hhmmOf(p.hours * 60 + p.minutes); })();
  const chips = [...suggestions.filter((s) => minutesOf(s.value) !== null), { label: 'Now', value: nowIst }];

  return (
    <>
      <button
        type="button"
        id={id || autoId}
        ref={anchorRef}
        className={`dtp-trigger${value ? '' : ' is-empty'}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value ? timeLabel(value) : 'not chosen'}. Open clock`}
      >
        <Icon name="Clock3" size={16} />
        <span>{value ? timeLabel(value) : placeholder}</span>
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label={`${label} clock`} width={292}>
        <div className="dtp-clock" onKeyDown={onPanelKey}>
          <div className="dtp-readout" ref={panelFocusRef} tabIndex={-1} aria-live="polite" aria-label={`${label} ${timeLabel(hhmmOf(minutes))}. Arrow keys change the ${mode === 'hour' ? 'hour' : 'minutes'}.`}>
            <div className="dtp-digits">
              <button type="button" className={mode === 'hour' ? 'is-on' : ''} onClick={() => setMode('hour')} aria-label="Change the hour">{pad(display12)}</button>
              <i>:</i>
              <button type="button" className={mode === 'minute' ? 'is-on' : ''} onClick={() => setMode('minute')} aria-label="Change the minutes">{pad(m)}</button>
              <span className="dtp-steps">
                <button type="button" onClick={() => set(minutes + (mode === 'hour' ? 60 : 1))} aria-label={mode === 'hour' ? 'One hour later' : 'One minute later'}><Icon name="ChevronUp" size={14} /></button>
                <button type="button" onClick={() => set(minutes - (mode === 'hour' ? 60 : 1))} aria-label={mode === 'hour' ? 'One hour earlier' : 'One minute earlier'}><Icon name="ChevronDown" size={14} /></button>
              </span>
            </div>
            <div className="dtp-ampm" role="group" aria-label="Morning or afternoon">
              <button type="button" className={!pm ? 'is-on' : ''} aria-pressed={!pm} onClick={() => setPm(false)}>AM</button>
              <button type="button" className={pm ? 'is-on' : ''} aria-pressed={pm} onClick={() => setPm(true)}>PM</button>
            </div>
          </div>
          <p className="dtp-hint">{mode === 'hour' ? 'Tap the hour' : 'Tap or drag to the minute'}</p>
          <ClockDial
            mode={mode}
            minutes={minutes}
            onPick={(v) => (mode === 'hour' ? pickHour(v) : pickMinute(v))}
            onRelease={() => { if (mode === 'hour') setMode('minute'); }}
          />
          <div className="dtp-foot">
            {chips.slice(0, 3).map((chip) => (
              <button type="button" key={`${chip.label}-${chip.value}`} className="dtp-chip" onClick={() => { onChange?.(hhmmOf(minutesOf(chip.value))); setMode('minute'); }}>
                {chip.label} · {timeLabel(chip.value)}
              </button>
            ))}
            <button type="button" className="dtp-done" onClick={() => { if (current === null) set(minutes); setOpen(false); anchorRef.current?.focus(); }}>Done</button>
          </div>
        </div>
      </Popover>
    </>
  );
}

/* --------------------------------------------------------------- both */

/**
 * value "YYYY-MM-DDTHH:mm" (India time). Leave `clearable` off for required times.
 * timeSuggestions: [{ label: 'Shift start', value: '10:00' }]
 */
export function DateTimeField({ value, onChange, label, minDate, maxDate, timeSuggestions = [], defaultDate, defaultTime = '10:00', disabled = false, clearable = false }) {
  const [datePart = '', timePart = ''] = value ? String(value).split('T') : [];
  const date = datePart || defaultDate || '';
  const emit = (d, t) => onChange?.(d && t ? `${d}T${t.slice(0, 5)}` : '');
  return (
    <div className="dtp-field" role="group" aria-label={label}>
      {label && <span className="dtp-label">{label}</span>}
      <div className="dtp-row">
        <DatePicker value={date} min={minDate} max={maxDate} label={`${label || 'Date'} date`} disabled={disabled} onChange={(d) => emit(d, timePart || defaultTime)} />
        <TimePicker value={timePart} label={`${label || 'Time'} time`} disabled={disabled} suggestions={timeSuggestions} defaultValue={defaultTime} onChange={(t) => emit(date || defaultDate, t)} />
        {clearable && value && <button type="button" className="dtp-clear" onClick={() => onChange?.('')} aria-label={`Clear ${label || 'time'}`}><Icon name="X" size={14} /></button>}
      </div>
    </div>
  );
}

export { addDays as addDaysToKey, dayLabel as formatPickerDay };
