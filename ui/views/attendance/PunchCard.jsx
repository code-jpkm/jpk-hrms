import React, { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { formatDayKey, formatTime, durationLabel, clockLabel, greetingFor, istParts, todayKey } from '../../utils/time.js';

function useTick(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function LiveClock() {
  const now = useTick(1000);
  const p = istParts(now);
  const h12 = ((p.hours + 11) % 12) + 1;
  return (
    <div className="att-clock" aria-label="Current India time">
      <b>{String(h12).padStart(2, '0')}:{String(p.minutes).padStart(2, '0')}<span style={{ fontSize: '0.45em', opacity: 0.75 }}>:{String(p.seconds).padStart(2, '0')}</span></b>
      <span>{p.hours >= 12 ? 'PM' : 'AM'} · IST</span>
    </div>
  );
}

function Ring({ value = 0, max = 1, label, sub, color = '#FFFFFF' }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="att-ring">
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={r} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="12" />
        <circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} style={{ transition: 'stroke-dasharray .6s ease' }} />
      </svg>
      <div className="att-ring-label"><div><b>{label}</b><small>{sub}</small></div></div>
    </div>
  );
}

/**
 * "Me, today": live clock, shift, punch state and a worked-time ring.
 * Always about the signed-in person, whichever calendar is open below.
 */
export default function PunchCard({ firstName, state, stateError, onPunch, punching, monthSummary, onRequestCorrection }) {
  const now = useTick(30000);
  const record = state?.attendance;
  const shift = state?.shift;
  const live = Boolean(record?.checkIn && !record?.checkOut);
  const worked = record?.checkIn ? Math.max(0, Math.round(((record.checkOut ? new Date(record.checkOut) : now) - new Date(record.checkIn)) / 60000)) : 0;
  const target = shift?.durationMinutes || 480;
  const late = Number(state?.lateMinutes || 0);
  const mobileMode = state?.mobile?.mode;
  const canPunchHere = state?.mobile?.enabled || mobileMode === 'WFH_ONLY';
  const remaining = Math.max(0, target - worked);
  const dutyDate = state?.date || todayKey();

  let statusChip = null;
  if (!state) statusChip = null;
  else if (state.completed) statusChip = <span className="att-chip is-good"><Icon name="CheckCheck" size={14} /> Day complete · {durationLabel(worked)}</span>;
  else if (live) statusChip = late ? <span className="att-chip is-warn"><Icon name="AlarmClock" size={14} /> Checked in {late}m late</span> : <span className="att-chip is-good"><Icon name="BadgeCheck" size={14} /> Checked in on time</span>;
  else statusChip = <span className="att-chip"><Icon name="CircleDot" size={14} /> Not checked in yet</span>;

  return (
    <section className="att-hero">
      <div>
        <span className="att-hero-kicker"><Icon name="CalendarClock" size={14} /> Time &amp; attendance</span>
        <h1>{greetingFor(now)}{firstName ? `, ${firstName}` : ''}</h1>
        <div className="att-hero-date">{formatDayKey(dutyDate)}</div>
        <div className="att-shift-line">
          {shift ? <span className="att-chip"><Icon name="Clock3" size={14} /> {shift.name} · {clockLabel(shift.startTime)} – {clockLabel(shift.endTime)}</span> : <span className="att-chip"><Icon name="Clock3" size={14} /> No shift assigned</span>}
          {statusChip}
          {record?.location?.siteName && <span className="att-chip"><Icon name="MapPin" size={14} /> {record.location.siteName}</span>}
        </div>
        <LiveClock />
        {stateError ? (
          <p className="att-hero-note"><Icon name="Info" size={14} /> {stateError}</p>
        ) : (
          <div className="att-punch-row">
            {canPunchHere && state?.canCheckIn && (
              <button type="button" className="att-punch-btn" onClick={() => onPunch('in')} disabled={punching}>
                <Icon name="LogIn" size={18} /> {punching ? 'Locating you…' : mobileMode === 'WFH_ONLY' ? 'Check in (WFH)' : 'Check in'}
              </button>
            )}
            {canPunchHere && state?.canCheckOut && (
              <button type="button" className="att-punch-btn is-out" onClick={() => onPunch('out')} disabled={punching}>
                <span className="pulse" /> <Icon name="LogOut" size={18} /> {punching ? 'Locating you…' : 'Check out'}
              </button>
            )}
            {state && !canPunchHere && !state.completed && (
              <span className="att-chip"><Icon name="Fingerprint" size={14} /> Punch on the biometric device — your attendance syncs here automatically</span>
            )}
            <button type="button" className="att-ghost-btn" onClick={onRequestCorrection}><Icon name="PenLine" size={15} /> Request a correction</button>
          </div>
        )}
        {state?.notice && <p className="att-hero-note is-alert"><Icon name="TriangleAlert" size={14} /> {state.notice}</p>}
        {mobileMode === 'GEOFENCE' && state?.canCheckIn && <p className="att-hero-note"><Icon name="MapPin" size={14} /> Check-in works inside an approved office or plant location. Allow location access when asked.</p>}
      </div>

      <div className="att-today-panel">
        <div className="att-ring-card">
          <Ring value={worked} max={target} label={record?.checkIn ? durationLabel(worked, { short: true }) : '0h'} sub={`of ${durationLabel(target, { short: true })} shift`} color={live ? '#F38121' : '#142330'} />
          <div className="att-today-facts">
            <div><span>Checked in</span><b>{formatTime(record?.checkIn)}</b></div>
            <div><span>Checked out</span><b>{formatTime(record?.checkOut)}</b></div>
            <div><span>{live ? 'Shift left' : 'Late in'}</span><b>{live ? durationLabel(remaining) : late ? `${late} min` : '—'}</b></div>
          </div>
        </div>
        {monthSummary && (
          <div className="att-mini-stats" title="Your attendance this month so far">
            <div><b>{monthSummary.attendanceRate ?? '—'}{monthSummary.attendanceRate !== null && monthSummary.attendanceRate !== undefined ? '%' : ''}</b><span>This month</span></div>
            <div><b>{monthSummary.onTimeRate ?? '—'}{monthSummary.onTimeRate !== null && monthSummary.onTimeRate !== undefined ? '%' : ''}</b><span>On time</span></div>
            <div><b>{monthSummary.lopDays ?? 0}</b><span>LOP this month</span></div>
          </div>
        )}
      </div>
    </section>
  );
}
