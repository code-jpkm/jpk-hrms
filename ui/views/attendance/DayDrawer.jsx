import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '../../lib/router.jsx';
import Icon from '../../components/Icon.jsx';
import { post } from '../../api/client.js';
import { formatDayKey, formatTime, durationLabel, parseHHMM, istMinutes, toIstInputValue, istInputToIso, clockLabel } from '../../utils/time.js';
import { statusMeta, LEAVE_NAMES } from './meta.js';

function ShiftTimeline({ day }) {
  const data = useMemo(() => {
    const shiftStart = parseHHMM(day.shiftStart);
    let shiftEnd = parseHHMM(day.shiftEnd);
    if (shiftStart !== null && shiftEnd !== null && shiftEnd <= shiftStart) shiftEnd += 1440;
    let inM = istMinutes(day.checkIn);
    let outM = day.checkOut ? istMinutes(day.checkOut) : (day.status === 'IN_PROGRESS' ? istMinutes(new Date()) : null);
    // Overnight shifts: anything "before" the start belongs to the next morning.
    if (shiftStart !== null && inM !== null && shiftEnd > 1440 && inM < shiftStart - 240) inM += 1440;
    if (inM !== null && outM !== null && outM < inM) outM += 1440;
    const points = [shiftStart, shiftEnd, inM, outM].filter((v) => v !== null && v !== undefined);
    if (!points.length) return null;
    const lo = Math.floor((Math.min(...points) - 60) / 60) * 60;
    const hi = Math.ceil((Math.max(...points) + 60) / 60) * 60;
    const span = Math.max(60, hi - lo);
    const pos = (m) => `${((m - lo) / span) * 100}%`;
    const width = (a, b) => `${(Math.max(0, b - a) / span) * 100}%`;
    const ticks = [];
    const step = span > 720 ? 180 : 120;
    for (let t = lo; t <= hi; t += step) ticks.push(t);
    return { shiftStart, shiftEnd, inM, outM, pos, width, ticks, grace: Number(day.shiftGraceMinutes || 0) };
  }, [day]);
  if (!data) return <p className="att-empty" style={{ padding: 12 }}>No shift or punches to draw for this day.</p>;
  const label = (m) => {
    const x = ((m % 1440) + 1440) % 1440;
    return clockLabel(`${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`);
  };
  return (
    <div className="att-timeline">
      <div className="att-track">
        {data.shiftStart !== null && data.shiftEnd !== null && <span className="shift" style={{ left: data.pos(data.shiftStart), width: data.width(data.shiftStart, data.shiftEnd) }} />}
        {data.shiftStart !== null && data.grace > 0 && <span className="grace" style={{ left: data.pos(data.shiftStart), width: data.width(data.shiftStart, data.shiftStart + data.grace) }} />}
        {data.inM !== null && <span className={`work ${day.status === 'IN_PROGRESS' ? 'is-live' : ''}`} style={{ left: data.pos(data.inM), width: data.width(data.inM, data.outM ?? data.inM + 2) }} />}
        {data.inM !== null && <span className="att-marker" style={{ left: data.pos(data.inM) }}>In {formatTime(day.checkIn)}</span>}
        {day.checkOut && data.outM !== null && <span className="att-marker" style={{ left: data.pos(data.outM) }}>Out {formatTime(day.checkOut)}</span>}
      </div>
      <div className="att-ticks">{data.ticks.map((t) => <span key={t} style={{ left: data.pos(t) }}>{label(t)}</span>)}</div>
      <div className="att-timeline-legend">
        <span><i style={{ background: 'rgba(31,52,69,0.25)', border: '1px dashed rgba(31,52,69,0.6)' }} />Shift {clockLabel(day.shiftStart)}–{clockLabel(day.shiftEnd)}</span>
        {data.grace > 0 && <span><i style={{ background: 'rgba(243,129,33,0.35)' }} />{data.grace} min grace</span>}
        <span><i style={{ background: '#1F3445' }} />Time on duty</span>
      </div>
    </div>
  );
}

function reasonsOf(text) {
  return String(text || '').split(/;\s*|\s·\s/).map((s) => s.trim()).filter(Boolean);
}

export default function DayDrawer({ day, employee, isSelf, canOverride, canRequestForOthers, showWfh, onClose, onSaved }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const defaultIn = day.checkIn ? toIstInputValue(day.checkIn) : (day.shiftStart ? `${day.date}T${day.shiftStart}` : `${day.date}T09:30`);
  const defaultOut = day.checkOut ? toIstInputValue(day.checkOut) : (day.shiftEnd ? `${day.date}T${day.shiftEnd}` : `${day.date}T18:30`);
  const [request, setRequest] = useState({ requestType: day.missingPunch || day.status === 'ABSENT' ? 'ATTENDANCE_CORRECTION' : day.lateMinutes ? 'LATE_IN' : day.earlyLeaveMinutes ? 'EARLY_LEAVE' : 'ATTENDANCE_CORRECTION', checkIn: defaultIn, checkOut: defaultOut, minutes: day.lateMinutes || day.earlyLeaveMinutes || 0, reason: '' });
  const [override, setOverride] = useState({ checkIn: defaultIn, checkOut: defaultOut, status: ['HOLIDAY', 'WEEK_OFF', 'NOT_MARKED', 'IN_PROGRESS', 'ABSENT'].includes(day.status) ? 'PRESENT' : day.status, dayPart: day.dayPart || 'FULL', lopDays: day.lopDays || 0, overrideCategory: 'SYSTEM_CORRECTION', remarks: '' });

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = statusMeta(day.status);
  const reasons = reasonsOf(day.deductionReason);
  const canRequest = isSelf || canRequestForOthers;
  const isPast = !day.isFuture;

  async function submitRequest(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { date: day.date, requestType: request.requestType, reason: request.reason, employeeId: isSelf ? undefined : employee?._id };
      if (request.requestType === 'ATTENDANCE_CORRECTION') { body.requestedCheckIn = istInputToIso(request.checkIn); body.requestedCheckOut = istInputToIso(request.checkOut); }
      else body.requestedMinutes = Number(request.minutes || 0);
      // On someone else's day the server approves it straight away when you are their approver; it tells us which.
      await post('/regularizations/apply', body, { loadingMessage: isSelf ? 'Sending your request…' : 'Saving the correction…' });
      onSaved?.();
      onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function submitOverride(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await post('/attendance/override', { employeeId: employee?._id, date: day.date, checkIn: istInputToIso(override.checkIn), checkOut: istInputToIso(override.checkOut), status: override.status, dayPart: override.dayPart, lopDays: Number(override.lopDays || 0), overrideCategory: override.overrideCategory, remarks: override.remarks }, { loadingMessage: 'Saving correction…', successMessage: 'Attendance corrected' });
      onSaved?.();
      onClose();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="att-drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="att-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Attendance on ${day.date}`}>
        <div className="att-drawer-head">
          <div>
            <small>{employee ? `${employee.firstName} ${employee.lastName || ''} · ${employee.employeeCode}` : 'Attendance detail'}</small>
            <h2>{formatDayKey(day.date)}</h2>
          </div>
          <button type="button" className="att-close" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="att-drawer-body">
          <div className="att-drawer-status" style={{ '--pill': meta.dot, '--pill-soft': meta.soft }}>
            <span className="att-status-lg">{day.workedOnHoliday ? 'Worked on holiday' : meta.label}</span>
            {day.holidayName && <span className="att-flag" style={{ height: 26 }}><Icon name="PartyPopper" size={12} /> {day.holidayName}</span>}
            {day.leaveType && <span className="att-flag" style={{ height: 26 }}>{LEAVE_NAMES[day.leaveType] || day.leaveType}</span>}
            {Number(day.lopDays) > 0 && <span className="att-flag lop" style={{ height: 26 }}>{day.lopDays} day LOP{day.lopOverridden ? ' (set by HR)' : ''}</span>}
            {day.missingPunch && <span className="att-flag miss" style={{ height: 26 }}><Icon name="TriangleAlert" size={12} /> Missing punch</span>}
            {day.pendingRegularization && <span className="att-flag pending" style={{ height: 26 }}><Icon name="Hourglass" size={12} /> Correction pending</span>}
          </div>

          {mode === 'view' && <>
            <div className="att-box">
              <h4>Shift vs actual</h4>
              <ShiftTimeline day={day} />
            </div>
            <div className="att-facts">
              <div><span>Check in</span><b>{formatTime(day.checkIn)}</b></div>
              <div><span>Check out</span><b>{day.checkOut ? formatTime(day.checkOut) : day.status === 'IN_PROGRESS' ? 'On duty' : '—'}</b></div>
              <div><span>Worked</span><b>{day.workedMinutes ? durationLabel(day.workedMinutes) : '—'}</b></div>
              <div><span>Late in</span><b className={day.lateMinutes > (day.shiftGraceMinutes || 0) ? 'warn' : ''}>{day.lateMinutes ? `${day.lateMinutes} min` : 'On time'}</b></div>
              <div><span>Early out</span><b className={day.earlyLeaveMinutes ? 'warn' : ''}>{day.earlyLeaveMinutes ? `${day.earlyLeaveMinutes} min` : '—'}</b></div>
              <div><span>Loss of pay</span><b className={Number(day.lopDays) > 0 ? 'bad' : 'good'}>{Number(day.lopDays) > 0 ? `${day.lopDays} day` : 'None'}</b></div>
            </div>
            <div className="att-box">
              <h4>How this day was calculated</h4>
              {reasons.length ? (
                <ul className="att-rule-list">{reasons.map((r, i) => <li key={i}><Icon name="CircleCheck" size={14} />{r}</li>)}</ul>
              ) : (
                <p className="att-empty" style={{ padding: 4, textAlign: 'left' }}>{day.status === 'IN_PROGRESS' ? `Checked in at ${formatTime(day.checkIn)}${day.progressLabel ? ` · ${day.progressLabel}` : ''}. Check-out is still pending.` : day.status === 'ABSENT' && !day.checkIn ? 'No punch was recorded for this working day, so it counts as absent (1 day LOP) unless leave or a correction is approved.' : 'No exception recorded for this date.'}</p>
              )}
              {(day.source || day.siteName) && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--att-muted)', fontWeight: 700 }}><Icon name="Fingerprint" size={12} /> Source: {String(day.source || 'SYSTEM').replaceAll('_', ' ').toLowerCase()}{day.siteName ? ` · ${day.siteName}` : ''}</p>}
            </div>

            {day.missingPunch && <div className="att-alert"><Icon name="TriangleAlert" size={16} /><div>Only one punch was recorded, so payroll treats this day as absent. Request a correction with the right in and out time.</div></div>}

            <div className="att-action-row">
              {canRequest && isPast && <button type="button" className="att-btn" onClick={() => setMode('request')}><Icon name="PenLine" size={16} /> {isSelf ? 'Request a correction' : 'Raise a correction'}</button>}
              {canOverride && <button type="button" className="att-btn secondary" onClick={() => setMode('override')}><Icon name="ShieldCheck" size={16} /> Correct as HR</button>}
              {isSelf && !['HOLIDAY', 'WEEK_OFF', 'LEAVE'].includes(day.status) && <button type="button" className="att-btn secondary" onClick={() => navigate('/leave')}><Icon name="Palmtree" size={16} /> Apply leave</button>}
            </div>
          </>}

          {mode === 'request' && (
            <form className="att-form att-box" onSubmit={submitRequest}>
              <h4>Request a correction</h4>
              <label>What needs fixing?
                <select value={request.requestType} onChange={(e) => setRequest({ ...request, requestType: e.target.value })}>
                  <option value="ATTENDANCE_CORRECTION">Wrong or missing punch time</option>
                  <option value="LATE_IN">Permission for late arrival</option>
                  <option value="EARLY_LEAVE">Permission for leaving early</option>
                  <option value="MEDICAL">Medical reason</option>
                  <option value="SPECIAL">Special approval</option>
                </select>
              </label>
              {request.requestType === 'ATTENDANCE_CORRECTION' ? (
                <div className="att-form-grid">
                  <label>Actual check-in (IST)<input type="datetime-local" value={request.checkIn} onChange={(e) => setRequest({ ...request, checkIn: e.target.value })} /></label>
                  <label>Actual check-out (IST)<input type="datetime-local" value={request.checkOut} onChange={(e) => setRequest({ ...request, checkOut: e.target.value })} /></label>
                </div>
              ) : (
                <label>Minutes<input type="number" min="0" max="600" value={request.minutes} onChange={(e) => setRequest({ ...request, minutes: e.target.value })} /><small>How late you arrived or how early you left.</small></label>
              )}
              <label>Reason<textarea required minLength={3} placeholder="e.g. Biometric device was not working at the gate" value={request.reason} onChange={(e) => setRequest({ ...request, reason: e.target.value })} /></label>
              {error && <div className="att-alert"><Icon name="TriangleAlert" size={16} /><div>{error}</div></div>}
              <div className="att-action-row">
                <button className="att-btn" disabled={busy}><Icon name={isSelf ? 'SendHorizontal' : 'CheckCircle2'} size={16} /> {busy ? 'Saving…' : isSelf ? 'Send to approver' : 'Save & approve'}</button>
                <button type="button" className="att-btn secondary" onClick={() => setMode('view')}>Back</button>
              </div>
              <small>{isSelf ? 'Your reporting manager gets an in-app alert, plus email / WhatsApp if HR has switched those on.' : 'You are recording this for the employee, so it is approved immediately and they are notified.'}</small>
            </form>
          )}

          {mode === 'override' && (
            <form className="att-form att-box" onSubmit={submitOverride}>
              <h4>HR correction</h4>
              <div className="att-alert info"><Icon name="Info" size={16} /><div>Times are India time. The correction is saved with your name and the reason in the audit log.</div></div>
              <div className="att-form-grid">
                <label>Check-in (IST)<input type="datetime-local" value={override.checkIn} onChange={(e) => setOverride({ ...override, checkIn: e.target.value })} /></label>
                <label>Check-out (IST)<input type="datetime-local" value={override.checkOut} onChange={(e) => setOverride({ ...override, checkOut: e.target.value })} /></label>
                <label>Status
                  <select value={override.status} onChange={(e) => setOverride({ ...override, status: e.target.value })}>
                    <option value="PRESENT">Present</option><option value="ABSENT">Absent</option><option value="HALF_DAY">Half day</option>
                    {showWfh && <option value="WFH">Work from home</option>}<option value="LEAVE">Leave</option>
                  </select>
                </label>
                <label>Day part
                  <select value={override.dayPart} onChange={(e) => setOverride({ ...override, dayPart: e.target.value })}>
                    <option value="FULL">Full day</option><option value="FIRST_HALF">First half</option><option value="SECOND_HALF">Second half</option>
                  </select>
                </label>
                <label>LOP days<input type="number" step="0.5" min="0" max="1" value={override.lopDays} onChange={(e) => setOverride({ ...override, lopDays: e.target.value })} /></label>
                <label>Category
                  <select value={override.overrideCategory} onChange={(e) => setOverride({ ...override, overrideCategory: e.target.value })}>
                    <option value="SYSTEM_CORRECTION">System correction</option><option value="MEDICAL">Medical</option><option value="SPECIAL">Special</option><option value="MANAGEMENT_APPROVAL">Management approval</option><option value="OTHER">Other</option>
                  </select>
                </label>
              </div>
              <label>Reason (required)<textarea required value={override.remarks} onChange={(e) => setOverride({ ...override, remarks: e.target.value })} placeholder="e.g. Card reader at Gate 2 was offline 09:00–11:00" /></label>
              {error && <div className="att-alert"><Icon name="TriangleAlert" size={16} /><div>{error}</div></div>}
              <div className="att-action-row">
                <button className="att-btn" disabled={busy}><Icon name="Save" size={16} /> {busy ? 'Saving…' : 'Save correction'}</button>
                <button type="button" className="att-btn secondary" onClick={() => setMode('view')}>Back</button>
              </div>
            </form>
          )}
        </div>
      </aside>
    </div>
  );
}
