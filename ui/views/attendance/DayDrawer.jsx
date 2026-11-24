import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '../../lib/router.jsx';
import Icon from '../../components/Icon.jsx';
import { post } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { DateTimeField, addDaysToKey } from '../../components/DateTimePicker.jsx';
import { formatDayKey, formatTime, formatPunch, durationLabel, parseHHMM, istMinutes, toIstInputValue, clockLabel, monthLabel } from '../../utils/time.js';
import { statusMeta, LEAVE_NAMES } from './meta.js';
import PunchPlaces from './PunchPlace.jsx';
import ShiftPicker from '../../components/ShiftPicker.jsx';

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
        {data.inM !== null && <span className="att-marker" style={{ left: data.pos(data.inM) }}>In {formatPunch(day.checkIn)}</span>}
        {day.checkOut && data.outM !== null && <span className="att-marker" style={{ left: data.pos(data.outM) }}>Out {formatPunch(day.checkOut)}</span>}
      </div>
      <div className="att-ticks">{data.ticks.map((t) => <span key={t} style={{ left: data.pos(t) }}>{label(t)}</span>)}</div>
      <div className="att-timeline-legend">
        <span><i style={{ background: 'rgba(31,52,69,0.25)', border: '1px dashed rgba(31,52,69,0.6)' }} />Shift {clockLabel(day.shiftStart)}–{clockLabel(day.shiftEnd)}</span>
        {data.grace > 0 && <span><i style={{ background: 'rgba(243,129,33,0.35)' }} />{data.grace} min grace: arriving inside it is on time</span>}
        <span><i style={{ background: '#1F3445' }} />Time on duty</span>
      </div>
    </div>
  );
}

function reasonsOf(text) {
  return String(text || '').split(/;\s*|\s·\s/).map((s) => s.trim()).filter(Boolean);
}

const MARK_CHOICES = [
  { value: 'PRESENT', label: 'Present', hint: 'Full day, no loss of pay' },
  { value: 'HALF_DAY', label: 'Half day', hint: '0.5 day loss of pay' },
  { value: 'ABSENT', label: 'Absent', hint: '1 day loss of pay' }
];
const LOP_CATEGORIES = [['SPECIAL', 'Special approval'], ['MEDICAL', 'Medical'], ['MANAGEMENT_APPROVAL', 'Management approval'], ['SYSTEM_CORRECTION', 'System / device problem'], ['OTHER', 'Other']];
const NO_DUTY = ['HOLIDAY', 'WEEK_OFF', 'UPCOMING', 'NOT_JOINED'];

/** "2026-11-19T18:05" from an instant, or the given HH:mm on the day. */
function pickerValue(instant, dayKey, fallbackHHMM) {
  if (instant) return toIstInputValue(instant);
  return fallbackHHMM ? `${dayKey}T${fallbackHHMM}` : '';
}

export default function DayDrawer({ day, employee, isSelf, perms = {}, payrollStatus = null, showWfh, onClose, onSaved }) {
  const navigate = useNavigate();
  const {
    canOverride = false,
    canFixTimes = false,
    canManageShifts = false,
    canDecideLeave = false,
    canAddLeave = false,
    canDecideRequests = false,
    selfApproves = false
  } = perms;
  // Your own day goes to your approver unless you are the Super Admin.
  const instant = !isSelf || selfApproves;
  const [mode, setMode] = useState('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [times, setTimes] = useState({ checkIn: '', checkOut: '', reason: '' });
  const [mark, setMark] = useState({ status: 'PRESENT', reason: '' });
  const [lop, setLop] = useState({ reason: '', category: 'SPECIAL' });
  const [shiftForm, setShiftForm] = useState({ shiftId: '', scope: 'DAY' });
  const [leave, setLeave] = useState({ leaveType: '', dayPart: 'FULL', reason: '' });
  const [decisionNote, setDecisionNote] = useState('');
  const [request, setRequest] = useState({ requestType: 'ATTENDANCE_CORRECTION', checkIn: '', checkOut: '', minutes: 0, reason: '' });
  const [override, setOverride] = useState({ checkIn: '', checkOut: '', status: 'PRESENT', dayPart: 'FULL', lopDays: 0, overrideCategory: 'SYSTEM_CORRECTION', remarks: '' });

  const { data: shiftsData } = useApi(mode === 'shift' ? '/shifts' : '', [mode], { skeleton: false });
  const { data: balanceData } = useApi(mode === 'leave' && employee?._id ? `/leaves/balances?employeeId=${employee._id}` : '', [mode, employee?._id], { skeleton: false });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (mode !== 'view') setMode('view');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, mode]);

  const meta = statusMeta(day.status);
  const reasons = reasonsOf(day.deductionReason);
  const isPast = !day.isFuture;
  const isReview = day.status === 'REVIEW';
  const isLeaveDay = day.status === 'LEAVE';
  const noDuty = NO_DUTY.includes(day.status);
  const firstName = employee?.firstName || 'the employee';
  const nextDay = addDaysToKey(day.date, 1);
  const inSuggestions = day.shiftStart ? [{ label: 'Shift start', value: day.shiftStart }] : [];
  const outSuggestions = day.shiftEnd ? [{ label: 'Shift end', value: day.shiftEnd }] : [];
  const canMark = canOverride && isPast && !isLeaveDay && !noDuty && day.status !== 'WFH';
  const canRemoveLop = canOverride && isPast && Number(day.lopDays) > 0 && !day.lopOverridden && !isLeaveDay;
  const canUndo = canOverride && day.canUndoHrChange;
  const canAddLeaveHere = canAddLeave && !isLeaveDay && !day.pendingLeaveRequest && !['HOLIDAY', 'NOT_JOINED'].includes(day.status);
  const canFix = canFixTimes && isPast && !noDuty && !isLeaveDay;
  const quickActions = canFix || canMark || canRemoveLop || canUndo || canManageShifts || canAddLeaveHere;

  function open(next, preset = {}) {
    setError('');
    setDone('');
    if (next === 'times') {
      setTimes({
        checkIn: pickerValue(day.checkIn, day.date, day.shiftStart || '10:00'),
        checkOut: pickerValue(day.checkOut, day.date, day.shiftEnd || '18:00'),
        reason: ''
      });
    }
    if (next === 'mark') setMark({ status: preset.status || (day.status === 'ABSENT' || isReview ? 'PRESENT' : day.status === 'PRESENT' ? 'HALF_DAY' : 'PRESENT'), reason: '' });
    if (next === 'lop') setLop({ reason: '', category: 'SPECIAL' });
    if (next === 'shift') setShiftForm({ shiftId: day.shiftId || '', scope: 'DAY' });
    if (next === 'leave') setLeave({ leaveType: '', dayPart: 'FULL', reason: '' });
    if (next === 'request') {
      setRequest({
        requestType: day.missingPunch || isReview || day.status === 'ABSENT' ? 'ATTENDANCE_CORRECTION' : day.lateMinutes ? 'LATE_IN' : day.earlyLeaveMinutes ? 'EARLY_LEAVE' : 'ATTENDANCE_CORRECTION',
        checkIn: pickerValue(day.checkIn, day.date, day.shiftStart || '09:30'),
        checkOut: pickerValue(day.checkOut, day.date, day.shiftEnd || '18:30'),
        minutes: day.lateMinutes || day.earlyLeaveMinutes || 0,
        reason: ''
      });
    }
    if (next === 'override') {
      setOverride({
        checkIn: pickerValue(day.checkIn, day.date, day.shiftStart || '09:30'),
        checkOut: pickerValue(day.checkOut, day.date, day.shiftEnd || '18:30'),
        status: ['HOLIDAY', 'WEEK_OFF', 'NOT_MARKED', 'IN_PROGRESS', 'ABSENT', 'REVIEW'].includes(day.status) ? 'PRESENT' : day.status,
        dayPart: day.dayPart || 'FULL',
        lopDays: day.lopDays || 0,
        overrideCategory: 'SYSTEM_CORRECTION',
        remarks: ''
      });
    }
    setMode(next);
  }

  /** One calendar action: saved, the day refreshed in place, payroll follows on the server. */
  async function act(body) {
    setBusy(true); setError(''); setDone('');
    try {
      const res = await post('/attendance/day-action', { employeeId: employee?._id, date: day.date, ...body }, { toast: false });
      setDone(res?.message || 'Saved.');
      setMode('view');
      onSaved?.(res?.day || null, res?.summary || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest(e) {
    e.preventDefault();
    setBusy(true); setError(''); setDone('');
    try {
      const body = { date: day.date, requestType: request.requestType, reason: request.reason, employeeId: isSelf ? undefined : employee?._id };
      if (request.requestType === 'ATTENDANCE_CORRECTION') { body.requestedCheckIn = request.checkIn; body.requestedCheckOut = request.checkOut; }
      else body.requestedMinutes = Number(request.minutes || 0);
      const res = await post('/regularizations/apply', body, { toast: false });
      setDone(res?.message || 'Request sent.');
      setMode('view');
      onSaved?.(null, null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function submitOverride(e) {
    e.preventDefault();
    setBusy(true); setError(''); setDone('');
    try {
      const res = await post('/attendance/override', { employeeId: employee?._id, date: day.date, checkIn: override.checkIn, checkOut: override.checkOut, status: override.status, dayPart: override.dayPart, lopDays: Number(override.lopDays || 0), overrideCategory: override.overrideCategory, remarks: override.remarks }, { toast: false });
      setDone(res?.message || 'Saved.');
      setMode('view');
      onSaved?.(null, null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const shifts = shiftsData?.shifts || [];
  const balances = (balanceData?.balances || []).filter((b) => String(b.leaveType).toUpperCase() !== 'LOP');
  const backRow = (label, icon = 'Save', blocked = false) => (
    <div className="att-action-row">
      <button className="att-btn" disabled={busy || blocked}><Icon name={icon} size={16} /> {busy ? 'Saving…' : label}</button>
      <button type="button" className="att-btn secondary" onClick={() => { setMode('view'); setError(''); }}>Back</button>
    </div>
  );
  const errorBox = error && <div className="att-alert" role="alert"><Icon name="TriangleAlert" size={16} /><div>{error}</div></div>;
  const monthName = monthLabel(day.date.slice(0, 7));

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
            <span className={`att-status-lg${isReview ? ' is-review' : ''}`}>{day.workedOnHoliday ? 'Worked on holiday' : meta.label}</span>
            {day.holidayName && <span className="att-flag" style={{ height: 26 }}><Icon name="PartyPopper" size={12} /> {day.holidayName}</span>}
            {day.leaveType && <span className="att-flag" style={{ height: 26 }}>{LEAVE_NAMES[day.leaveType] || day.leaveType}</span>}
            {Number(day.lopDays) > 0 && <span className="att-flag lop" style={{ height: 26 }}>{day.lopDays} day LOP{day.lopOverridden ? ' (set by HR)' : ''}</span>}
            {day.lopOverridden && Number(day.lopDays) === 0 && <span className="att-flag ok" style={{ height: 26 }}><Icon name="CircleCheck" size={12} /> No LOP (set by HR)</span>}
            {day.shiftName && <span className="att-flag" style={{ height: 26 }}><Icon name="Clock3" size={12} /> {day.shiftName}</span>}
            {day.pendingRegularization && <span className="att-flag pending" style={{ height: 26 }}><Icon name="Hourglass" size={12} /> Correction pending</span>}
            {day.pendingLeave && <span className="att-flag pending" style={{ height: 26 }}><Icon name="Hourglass" size={12} /> Leave pending</span>}
          </div>

          {done && <div className="att-alert good" role="status"><Icon name="CircleCheck" size={16} /><div>{done}</div></div>}
          {mode === 'view' && errorBox}

          {isReview && mode === 'view' && (
            <div className="att-review-card">
              <div className="att-review-head"><Icon name="CircleAlert" size={18} /><div>
                <b>{day.missingSide === 'IN' ? 'In time missing' : 'Out time missing'}{canOverride || canFix ? ': your decision' : ''}</b>
                <p>
                  {day.missingSide === 'IN'
                    ? `Only the out punch at ${formatPunch(day.checkOut)} was recorded.`
                    : `Only the in punch at ${formatPunch(day.checkIn)} was recorded.`}{' '}
                  {isSelf && !canOverride
                    ? 'HR will decide this day. Until then there is no loss of pay. If you know your out time, send it.'
                    : 'No loss of pay is charged until this is decided.'}
                </p>
              </div></div>
              <div className="att-review-actions">
                {canFix && <button type="button" className="att-btn" onClick={() => open('times')}><Icon name="Clock3" size={15} /> Set {day.missingSide === 'IN' ? 'in' : 'out'} time</button>}
                {canMark && <button type="button" className="att-btn secondary" onClick={() => open('mark', { status: 'PRESENT' })}>Full day</button>}
                {canMark && <button type="button" className="att-btn secondary" onClick={() => open('mark', { status: 'HALF_DAY' })}>Half day</button>}
                {canMark && <button type="button" className="att-btn secondary" onClick={() => open('mark', { status: 'ABSENT' })}>Absent</button>}
                {isSelf && !canFix && <button type="button" className="att-btn" onClick={() => open('request')}><Icon name="SendHorizontal" size={15} /> Send my {day.missingSide === 'IN' ? 'in' : 'out'} time</button>}
              </div>
            </div>
          )}

          {mode === 'view' && <>
            {day.pendingLeaveRequest && canDecideLeave && !isSelf && (
              <div className="att-pending-card">
                <div className="att-pending-head"><Icon name="Palmtree" size={16} /><div>
                  <b>{LEAVE_NAMES[day.pendingLeaveRequest.type] || day.pendingLeaveRequest.type} request waiting</b>
                  <small>
                    {day.pendingLeaveRequest.fromDate === day.pendingLeaveRequest.toDate
                      ? formatDayKey(day.pendingLeaveRequest.fromDate, { day: 'numeric', month: 'short' })
                      : `${formatDayKey(day.pendingLeaveRequest.fromDate, { day: 'numeric', month: 'short' })} – ${formatDayKey(day.pendingLeaveRequest.toDate, { day: 'numeric', month: 'short' })}`}
                    {' · '}{day.pendingLeaveRequest.days} day{Number(day.pendingLeaveRequest.days) === 1 ? '' : 's'}
                    {day.pendingLeaveRequest.dayPart !== 'FULL' ? ` (${day.pendingLeaveRequest.dayPart === 'FIRST_HALF' ? 'first half' : 'second half'})` : ''}
                    {day.pendingLeaveRequest.reason ? ` · “${day.pendingLeaveRequest.reason}”` : ''}
                  </small>
                </div></div>
                <input className="att-inline-input" placeholder="Note for the employee (optional)" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} aria-label="Note for the employee" />
                <div className="att-action-row">
                  <button type="button" className="att-btn" disabled={busy} onClick={() => act({ action: 'LEAVE_DECISION', requestId: day.pendingLeaveRequest.id, decision: 'APPROVED', remarks: decisionNote })}><Icon name="CheckCircle2" size={15} /> Approve leave</button>
                  <button type="button" className="att-btn secondary" disabled={busy} onClick={() => act({ action: 'LEAVE_DECISION', requestId: day.pendingLeaveRequest.id, decision: 'REJECTED', remarks: decisionNote })}><Icon name="CircleX" size={15} /> Reject</button>
                </div>
              </div>
            )}

            {day.pendingRegularizationRequest && canDecideRequests && !isSelf && (
              <div className="att-pending-card">
                <div className="att-pending-head"><Icon name="PenLine" size={16} /><div>
                  <b>{day.pendingRegularizationRequest.type === 'ATTENDANCE_CORRECTION' ? 'Time correction waiting' : `${String(day.pendingRegularizationRequest.type).replaceAll('_', ' ').toLowerCase()} permission waiting`}</b>
                  <small>
                    {day.pendingRegularizationRequest.type === 'ATTENDANCE_CORRECTION'
                      ? `In ${day.pendingRegularizationRequest.checkIn ? formatTime(day.pendingRegularizationRequest.checkIn) : 'unchanged'} · Out ${day.pendingRegularizationRequest.checkOut ? formatTime(day.pendingRegularizationRequest.checkOut) : 'unchanged'}`
                      : `${day.pendingRegularizationRequest.minutes || 0} min`}
                    {day.pendingRegularizationRequest.reason ? ` · “${day.pendingRegularizationRequest.reason}”` : ''}
                  </small>
                </div></div>
                <input className="att-inline-input" placeholder="Note for the employee (optional)" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} aria-label="Note for the employee" />
                <div className="att-action-row">
                  <button type="button" className="att-btn" disabled={busy} onClick={() => act({ action: 'REQUEST_DECISION', requestId: day.pendingRegularizationRequest.id, decision: 'APPROVED', remarks: decisionNote })}><Icon name="CheckCircle2" size={15} /> Approve</button>
                  <button type="button" className="att-btn secondary" disabled={busy} onClick={() => act({ action: 'REQUEST_DECISION', requestId: day.pendingRegularizationRequest.id, decision: 'REJECTED', remarks: decisionNote })}><Icon name="CircleX" size={15} /> Reject</button>
                </div>
              </div>
            )}

            <div className="att-facts">
              <div><span>Check in</span><b>{formatPunch(day.checkIn)}</b></div>
              <div><span>Check out</span><b className={isReview && day.missingSide === 'OUT' ? 'review' : ''}>{day.checkOut ? formatPunch(day.checkOut) : day.status === 'IN_PROGRESS' ? 'On duty' : isReview ? 'Missing' : '—'}</b></div>
              <div><span>Worked</span><b>{day.workedMinutes ? durationLabel(day.workedMinutes) : '—'}</b></div>
              <div><span>Late in</span><b className={Number(day.lateMinutes) > 0 ? 'warn' : ''}>{Number(day.lateMinutes) > 0 ? `${day.lateMinutes} min` : day.withinGrace ? 'On time (grace)' : day.checkIn ? 'On time' : '—'}</b></div>
              <div><span>Early out</span><b className={day.earlyLeaveMinutes ? 'warn' : ''}>{day.earlyLeaveMinutes ? `${day.earlyLeaveMinutes} min` : '—'}</b></div>
              <div><span>Loss of pay</span><b className={Number(day.lopDays) > 0 ? 'bad' : 'good'}>{Number(day.lopDays) > 0 ? `${day.lopDays} day` : 'None'}</b></div>
            </div>

            {quickActions && (
              <div className="att-box att-quick-box">
                <h4>Change this day</h4>
                {payrollStatus === 'FINALIZED' && <div className="att-alert" style={{ marginBottom: 10 }}><Icon name="Lock" size={15} /><div>{monthName} payroll is already released. Changes are saved to attendance, but released salary slips stay as they are.</div></div>}
                {payrollStatus === 'DRAFT' && <p className="att-quick-note"><Icon name="Wallet" size={13} /> {monthName} payroll is a draft: it updates as soon as you change a day.</p>}
                <div className="att-quick">
                  {canFix && <button type="button" onClick={() => open('times')}><Icon name="Clock3" size={18} /><b>Fix in / out time</b><small>{instant ? 'Saved and approved at once' : 'Sent to your approver'}</small></button>}
                  {canMark && <button type="button" onClick={() => open('mark')}><Icon name="UserCheck" size={18} /><b>Mark present / half / absent</b><small>Overrides the calculation</small></button>}
                  {canRemoveLop && <button type="button" onClick={() => open('lop')}><Icon name="Banknote" size={18} /><b>Remove LOP</b><small>Keep the day, no loss of pay</small></button>}
                  {canUndo && <button type="button" onClick={() => open('undo')}><Icon name="Undo2" size={18} /><b>Undo HR change</b><small>Calculate from punches again</small></button>}
                  {canManageShifts && <button type="button" onClick={() => open('shift')}><Icon name="CalendarClock" size={18} /><b>Change shift</b><small>{day.shiftName ? `Now: ${day.shiftName}` : 'This day or from this day on'}</small></button>}
                  {canAddLeaveHere && <button type="button" onClick={() => open('leave')}><Icon name="Palmtree" size={18} /><b>Add leave</b><small>{instant ? 'Recorded and approved' : 'Sent to your approver'}</small></button>}
                </div>
              </div>
            )}

            <div className="att-box">
              <h4>Shift vs actual</h4>
              <ShiftTimeline day={day} />
            </div>
            <PunchPlaces places={day.punchLocations} />
            <div className="att-box">
              <h4>How this day was calculated</h4>
              {reasons.length ? (
                <ul className="att-rule-list">{reasons.map((r, i) => <li key={i}><Icon name="CircleCheck" size={14} />{r}</li>)}</ul>
              ) : (
                <p className="att-empty" style={{ padding: 4, textAlign: 'left' }}>{day.status === 'IN_PROGRESS' ? `Checked in at ${formatPunch(day.checkIn)}${day.progressLabel ? ` · ${day.progressLabel}` : ''}. Check-out is still pending.` : day.status === 'ABSENT' && !day.checkIn ? 'No punch was recorded on a working day, so it counts as absent (1 day LOP) unless leave or a correction covers it.' : 'Nothing unusual on this day.'}</p>
              )}
              {(day.source || day.siteName) && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--att-muted)', fontWeight: 700 }}><Icon name="Fingerprint" size={12} /> Source: {String(day.source || 'SYSTEM').replaceAll('_', ' ').toLowerCase()}{day.siteName ? ` · ${day.siteName}` : ''}</p>}
            </div>

            <div className="att-action-row">
              {isSelf && isPast && !isReview && <button type="button" className="att-btn" onClick={() => open('request')}><Icon name="PenLine" size={16} /> Request a correction</button>}
              {!isSelf && canFix && <button type="button" className="att-btn secondary" onClick={() => open('request')}><Icon name="PenLine" size={16} /> Late / early permission</button>}
              {canOverride && <button type="button" className="att-btn secondary" onClick={() => open('override')}><Icon name="ShieldCheck" size={16} /> Advanced HR correction</button>}
              {isSelf && !['HOLIDAY', 'WEEK_OFF', 'LEAVE'].includes(day.status) && !canAddLeaveHere && <button type="button" className="att-btn secondary" onClick={() => navigate('/leave')}><Icon name="Palmtree" size={16} /> Apply leave</button>}
            </div>
          </>}

          {mode === 'times' && (
            <form className="att-form att-box" onSubmit={(e) => { e.preventDefault(); act({ action: 'SET_TIMES', checkIn: times.checkIn, checkOut: times.checkOut, reason: times.reason }); }}>
              <h4>Fix in / out time</h4>
              <p className="att-form-note">Pick the real times. The day is then calculated again with the normal rules (grace, late / early, half day){payrollStatus === 'DRAFT' ? ' and the payroll draft follows' : ''}.</p>
              <div className="att-form-grid">
                <DateTimeField label="In (India time)" value={times.checkIn} onChange={(v) => setTimes({ ...times, checkIn: v })} minDate={addDaysToKey(day.date, -1)} maxDate={day.date} defaultDate={day.date} defaultTime={day.shiftStart || '10:00'} timeSuggestions={inSuggestions} clearable />
                <DateTimeField label="Out (India time)" value={times.checkOut} onChange={(v) => setTimes({ ...times, checkOut: v })} minDate={day.date} maxDate={nextDay} defaultDate={day.date} defaultTime={day.shiftEnd || '18:00'} timeSuggestions={outSuggestions} clearable />
              </div>
              <label>Reason<textarea placeholder="e.g. Forgot to punch out, left at 6:05 pm (confirmed by manager)" value={times.reason} onChange={(e) => setTimes({ ...times, reason: e.target.value })} /><small>Saved in the requests history. {isSelf ? (instant ? '' : 'It goes to your approver.') : `${firstName} is told about the change.`}</small></label>
              {errorBox}
              {backRow(instant ? 'Save times' : 'Send for approval')}
            </form>
          )}

          {mode === 'mark' && (
            <form className="att-form att-box" onSubmit={(e) => { e.preventDefault(); act({ action: 'MARK', status: mark.status, reason: mark.reason }); }}>
              <h4>Count this day as</h4>
              <div className="att-choice" role="radiogroup" aria-label="Count this day as">
                {MARK_CHOICES.map((c) => (
                  <button type="button" key={c.value} role="radio" aria-checked={mark.status === c.value} className={mark.status === c.value ? 'is-on' : ''} onClick={() => setMark({ ...mark, status: c.value })}>
                    <b>{c.label}</b><small>{c.hint}</small>
                  </button>
                ))}
              </div>
              <label>Reason<textarea placeholder={mark.status === 'PRESENT' ? 'e.g. Was at the client site all day' : mark.status === 'ABSENT' ? 'e.g. Not at work; the punch was made by someone else' : 'e.g. Left after lunch with permission'} value={mark.reason} onChange={(e) => setMark({ ...mark, reason: e.target.value })} /><small>Saved with your name in the audit log. Undo it any time with “Undo HR change”.</small></label>
              {errorBox}
              {backRow(`Mark ${MARK_CHOICES.find((c) => c.value === mark.status)?.label.toLowerCase()}`, 'UserCheck')}
            </form>
          )}

          {mode === 'lop' && (
            <form className="att-form att-box" onSubmit={(e) => { e.preventDefault(); act({ action: 'REMOVE_LOP', reason: lop.reason, category: lop.category }); }}>
              <h4>Remove loss of pay</h4>
              <p className="att-form-note">The day stays {meta.label.toLowerCase()}, but its {day.lopDays} day LOP is removed{payrollStatus === 'DRAFT' ? ' and the payroll draft is updated' : ''}.</p>
              <label>Category
                <select value={lop.category} onChange={(e) => setLop({ ...lop, category: e.target.value })}>
                  {LOP_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>Reason (required)<textarea required minLength={3} placeholder="e.g. Bridge closed, approved by the plant head" value={lop.reason} onChange={(e) => setLop({ ...lop, reason: e.target.value })} /></label>
              {errorBox}
              {backRow('Remove LOP', 'Banknote')}
            </form>
          )}

          {mode === 'undo' && (
            <form className="att-form att-box" onSubmit={(e) => { e.preventDefault(); act({ action: 'UNDO' }); }}>
              <h4>Undo HR change</h4>
              <p className="att-form-note">{day.lopOverrideReason ? `Current HR decision: “${day.lopOverrideReason}”. ` : ''}The day goes back to what the punches and rules give.</p>
              {errorBox}
              {backRow('Undo', 'Undo2')}
            </form>
          )}

          {mode === 'shift' && (
            <form className="att-form att-box" onSubmit={(e) => { e.preventDefault(); act({ action: 'SHIFT', shiftId: shiftForm.shiftId, scope: shiftForm.scope }); }}>
              <h4>Change shift</h4>
              <div className="att-field">
                <span id="day-shift-label">Shift</span>
                <ShiftPicker shifts={shifts.filter((s) => s.active !== false)} value={shiftForm.shiftId} onChange={(id) => setShiftForm((f) => ({ ...f, shiftId: id }))} currentId={day.shiftId || ''} loading={!shiftsData} labelledBy="day-shift-label" id="day-shift" autoFocus />
              </div>
              <div className="att-choice two" role="radiogroup" aria-label="Apply to">
                <button type="button" role="radio" aria-checked={shiftForm.scope === 'DAY'} className={shiftForm.scope === 'DAY' ? 'is-on' : ''} onClick={() => setShiftForm({ ...shiftForm, scope: 'DAY' })}><b>Only this day</b><small>{formatDayKey(day.date, { day: 'numeric', month: 'short' })}</small></button>
                <button type="button" role="radio" aria-checked={shiftForm.scope === 'ONWARDS'} className={shiftForm.scope === 'ONWARDS' ? 'is-on' : ''} onClick={() => setShiftForm({ ...shiftForm, scope: 'ONWARDS' })}><b>From this day on</b><small>Becomes the regular shift</small></button>
              </div>
              <small className="att-form-note">Late, early and LOP are recalculated with the new shift times.</small>
              {errorBox}
              {backRow('Save shift', 'CalendarClock', !shiftForm.shiftId)}
            </form>
          )}

          {mode === 'leave' && (
            <form className="att-form att-box" onSubmit={(e) => { e.preventDefault(); act({ action: 'ADD_LEAVE', leaveType: leave.leaveType, dayPart: leave.dayPart, reason: leave.reason }); }}>
              <h4>Add leave for {formatDayKey(day.date, { day: 'numeric', month: 'short' })}</h4>
              <label>Leave type
                <select required value={leave.leaveType} onChange={(e) => setLeave({ ...leave, leaveType: e.target.value })}>
                  <option value="" disabled>{balanceData ? 'Choose' : 'Loading balances…'}</option>
                  {balances.map((b) => <option key={b.leaveType} value={b.leaveType} disabled={Number(b.available) <= 0}>{LEAVE_NAMES[b.leaveType] || b.leaveType} · {Number(b.available || 0)} left</option>)}
                  <option value="LOP">Unpaid leave (LOP)</option>
                  {showWfh && <option value="WFH">Work from home</option>}
                </select>
              </label>
              <div className="att-choice" role="radiogroup" aria-label="Day part">
                {[['FULL', 'Full day'], ['FIRST_HALF', 'First half'], ['SECOND_HALF', 'Second half']].map(([v, l]) => (
                  <button type="button" key={v} role="radio" aria-checked={leave.dayPart === v} className={leave.dayPart === v ? 'is-on' : ''} onClick={() => setLeave({ ...leave, dayPart: v })}><b>{l}</b></button>
                ))}
              </div>
              <label>Reason<textarea placeholder="e.g. Family function" value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} /></label>
              {errorBox}
              {backRow(instant ? 'Record leave' : 'Send for approval', 'Palmtree')}
            </form>
          )}

          {mode === 'request' && (
            <form className="att-form att-box" onSubmit={submitRequest}>
              <h4>{isSelf ? 'Request a correction' : 'Raise a correction'}</h4>
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
                  <DateTimeField label="Actual check-in" value={request.checkIn} onChange={(v) => setRequest({ ...request, checkIn: v })} minDate={addDaysToKey(day.date, -1)} maxDate={day.date} defaultDate={day.date} defaultTime={day.shiftStart || '09:30'} timeSuggestions={inSuggestions} clearable />
                  <DateTimeField label="Actual check-out" value={request.checkOut} onChange={(v) => setRequest({ ...request, checkOut: v })} minDate={day.date} maxDate={nextDay} defaultDate={day.date} defaultTime={day.shiftEnd || '18:30'} timeSuggestions={outSuggestions} clearable />
                </div>
              ) : (
                <label>Minutes<input type="number" min="0" max="600" value={request.minutes} onChange={(e) => setRequest({ ...request, minutes: e.target.value })} /><small>How late you arrived or how early you left.</small></label>
              )}
              <label>Reason<textarea required minLength={3} placeholder="e.g. Biometric device was not working at the gate" value={request.reason} onChange={(e) => setRequest({ ...request, reason: e.target.value })} /></label>
              {errorBox}
              <div className="att-action-row">
                <button className="att-btn" disabled={busy}><Icon name={isSelf ? 'SendHorizontal' : 'CheckCircle2'} size={16} /> {busy ? 'Saving…' : isSelf ? 'Send to approver' : 'Save & approve'}</button>
                <button type="button" className="att-btn secondary" onClick={() => setMode('view')}>Back</button>
              </div>
              <small>{isSelf ? 'Your reporting manager gets an in-app alert, plus email / WhatsApp if HR has switched those on.' : 'You are recording this for the employee, so it is approved immediately and they are notified.'}</small>
            </form>
          )}

          {mode === 'override' && (
            <form className="att-form att-box" onSubmit={submitOverride}>
              <h4>Advanced HR correction</h4>
              <div className="att-alert info"><Icon name="Info" size={16} /><div>Sets every value by hand. For everyday fixes use the buttons under “Change this day”. Saved with your name and the reason in the audit log.</div></div>
              <div className="att-form-grid">
                <DateTimeField label="Check-in" value={override.checkIn} onChange={(v) => setOverride({ ...override, checkIn: v })} minDate={addDaysToKey(day.date, -1)} maxDate={day.date} defaultDate={day.date} defaultTime={day.shiftStart || '09:30'} timeSuggestions={inSuggestions} clearable />
                <DateTimeField label="Check-out" value={override.checkOut} onChange={(v) => setOverride({ ...override, checkOut: v })} minDate={day.date} maxDate={nextDay} defaultDate={day.date} defaultTime={day.shiftEnd || '18:30'} timeSuggestions={outSuggestions} clearable />
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
              {errorBox}
              {backRow('Save correction')}
            </form>
          )}
        </div>
      </aside>
    </div>
  );
}
