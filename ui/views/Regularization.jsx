import React, { useEffect, useMemo, useState } from 'react';
import { toIstInputValue, istInputToIso, currentMonthKey, formatPunch, formatDayKey, formatDate } from '../utils/time.js';
import { Card, Empty, ErrorBox, Field } from '../components/Ui.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { canApplyOnBehalf, hasAbility } from '../utils/permissions.js';
import { statusMeta } from './attendance/meta.js';
import { DateTimeField, addDaysToKey } from '../components/DateTimePicker.jsx';
import '../styles/attendance.css';

const CLOSED = new Set(['HOLIDAY', 'WEEK_OFF', 'UPCOMING']);
const ISSUE = new Set(['ABSENT', 'HALF_DAY', 'NOT_MARKED']);
const fmtTime = (v) => v ? formatPunch(v) : 'Missing';
const prettyStatus = (v='') => v.replaceAll('_', ' ');
const dayName = (date, style='short') => formatDayKey(date, { weekday: style });
const longDate = (date) => formatDayKey(date, { weekday:'long', day:'2-digit', month:'long', year:'numeric' });

function hasShortfall(day) {
  if (!day || CLOSED.has(day.status)) return false;
  return ISSUE.has(day.status) || day.lateMinutes > 0 || day.earlyLeaveMinutes > 0 || day.lopDays > 0 || !day.checkIn || !day.checkOut;
}

export default function Regularization() {
  const { user, employee } = useAuth();
  const allowOnBehalf = canApplyOnBehalf(user);
  const canApprove = hasAbility(user, 'REGULARIZATION', 'APPROVE') || ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'].includes(user?.role);
  const [month, setMonth] = useState(currentMonthKey());
  const [employeeId, setEmployeeId] = useState(employee?._id || '');
  const [location, setLocation] = useState('ALL');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ requestType: 'ATTENDANCE_CORRECTION', requestedCheckIn: '', requestedCheckOut: '', requestedMinutes: 0, reason: '' });
  const [submitError, setSubmitError] = useState(null);
  const [approveNow, setApproveNow] = useState(true);
  const { data, error, reload } = useApi('/regularizations', []);
  const { data: employeesData } = useApi('/attendance/employees', []);
  const calendarQuery = employeeId ? `/attendance/calendar?month=${month}&employeeId=${employeeId}` : '';
  const { data: calendar, error: calendarError, reload: reloadCalendar } = useApi(calendarQuery, [calendarQuery]);
  const employees = employeesData?.employees || [];
  const visibleEmployees = useMemo(() => employees.filter((e) => location === 'ALL' || e.workLocation === location || e.workLocation === 'BOTH'), [employees, location]);

  useEffect(() => {
    if (!allowOnBehalf && employee?._id && employeeId !== employee._id) setEmployeeId(employee._id);
    if (allowOnBehalf && (!employeeId || !visibleEmployees.some((e) => e._id === employeeId)) && visibleEmployees.length) setEmployeeId(visibleEmployees[0]._id);
  }, [allowOnBehalf, employee?._id, employeeId, visibleEmployees]);

  const days = calendar?.days || [];
  const shortfalls = useMemo(() => days.filter(hasShortfall), [days]);
  const shownDays = onlyIssues ? shortfalls : days;
  const selectedEmployee = employees.find((e) => e._id === employeeId) || employee;
  // An approver correcting someone else's day records it as approved straight away.
  const onBehalf = Boolean(allowOnBehalf && employeeId && String(employeeId) !== String(employee?._id || ''));
  const willAutoApprove = onBehalf ? (canApprove && approveNow) : user?.role === 'SUPER_ADMIN';

  function choose(day) {
    if (CLOSED.has(day.status)) return;
    setSelected(day);
    const defaultIn = day.shiftStart || '09:30';
    const defaultOut = day.shiftEnd || '18:30';
    setForm({
      requestType: day.lateMinutes ? 'LATE_IN' : day.earlyLeaveMinutes ? 'EARLY_LEAVE' : 'ATTENDANCE_CORRECTION',
      requestedCheckIn: day.checkIn ? toIstInputValue(day.checkIn) : `${day.date}T${defaultIn}`,
      requestedCheckOut: day.checkOut ? toIstInputValue(day.checkOut) : `${day.date}T${defaultOut}`,
      requestedMinutes: day.lateMinutes || day.earlyLeaveMinutes || 0,
      reason: ''
    });
  }

  async function apply(e) {
    e.preventDefault(); setSubmitError(null);
    try {
      // Times are typed in India time; send them with an explicit +05:30 offset.
      await post('/regularizations/apply', { ...form, requestedCheckIn: istInputToIso(form.requestedCheckIn), requestedCheckOut: istInputToIso(form.requestedCheckOut), employeeId: allowOnBehalf ? employeeId : undefined, date: selected.date, ...(onBehalf && !approveNow ? { sendForApproval: true } : {}) }, { loadingMessage: willAutoApprove ? 'Saving and approving…' : 'Sending for approval…' });
      setSelected(null); reload(); reloadCalendar();
    } catch (err) { setSubmitError(err); }
  }
  async function decide(id, status) {
    try { await post(`/regularizations/${id}/decision`, { status, remarks: status }); reload(); reloadCalendar(); }
    catch (err) { setSubmitError(err); }
  }

  return <div className="nexus-page regularization-v3">
    <section className="directory-hero premium-hero page-intro"><div><small>TIME · EXCEPTIONS · PERMISSIONS</small><h1>Regularization Center</h1><p>Fix a missing or wrong punch, or ask permission for a late arrival or early exit. Pick a person and month, then click a day.</p></div></section>
    <ErrorBox error={error || calendarError || submitError} />

    <Card title="Month review">
      <div className="calendar-toolbar premium-toolbar">
        {allowOnBehalf && <div className="segmented scope-segment"><button className={location==='ALL'?'active':''} onClick={()=>setLocation('ALL')}>Both</button><button className={location==='OFFICE'?'active':''} onClick={()=>setLocation('OFFICE')}>Office</button><button className={location==='FACTORY'?'active':''} onClick={()=>setLocation('FACTORY')}>Factory</button></div>}
        <Field label="Employee"><select value={employeeId} disabled={!allowOnBehalf} onChange={(e)=>setEmployeeId(e.target.value)}>{visibleEmployees.map((e)=><option key={e._id} value={e._id}>{e.employeeCode} · {e.firstName} {e.lastName || ''} · {e.workLocation || 'FACTORY'}</option>)}</select></Field>
        <Field label="Month"><input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} /></Field>
        <label className="switch-row"><input type="checkbox" checked={onlyIssues} onChange={(e)=>setOnlyIssues(e.target.checked)}/><span>Only shortfalls</span></label>
      </div>

      <div className="reg-summary">
        <span><b>{selectedEmployee?.firstName} {selectedEmployee?.lastName || ''}</b> · {selectedEmployee?.employeeCode} · {selectedEmployee?.department || 'No department'}</span>
        <span className={shortfalls.length ? 'reg-count warn' : 'reg-count'}>{shortfalls.length ? `${shortfalls.length} day${shortfalls.length === 1 ? '' : 's'} need attention` : 'All days look fine'}</span>
      </div>

      {!shownDays.length ? <Empty>No attendance days found for this month.</Empty> : <div className="reg-list" role="table" aria-label="Days of the month">
        <div className="reg-row reg-head" role="row">
          <span>Date</span><span>Status</span><span>Shift</span><span>In</span><span>Out</span><span>Note</span><span />
        </div>
        {shownDays.map((d) => {
          const issue = hasShortfall(d);
          const closed = CLOSED.has(d.status);
          const meta = statusMeta(d.status);
          // Today is still running: an empty punch is not "missing" yet.
          const runningToday = d.isToday && ['NOT_MARKED', 'IN_PROGRESS'].includes(d.status);
          const notes = [d.lateMinutes > 0 && `Late ${d.lateMinutes}m`, d.earlyLeaveMinutes > 0 && `Left ${d.earlyLeaveMinutes}m early`, d.lopDays > 0 && `${d.lopDays} LOP`, !runningToday && !closed && d.status !== 'UPCOMING' && (!d.checkIn || !d.checkOut) && !['LEAVE', 'WFH'].includes(d.status) && 'Missing punch'].filter(Boolean);
          const timeOf = (v) => (v ? formatPunch(v) : runningToday || closed || ['UPCOMING', 'LEAVE', 'WFH'].includes(d.status) ? '—' : <i>Missing</i>);
          return <button type="button" role="row" key={d.date} className={`reg-row ${issue && !runningToday ? 'needs-action' : ''} ${closed ? 'is-closed' : ''} ${d.isToday ? 'is-today' : ''} ${selected?.date === d.date ? 'selected' : ''}`} onClick={() => choose(d)} disabled={closed}>
            <span className="reg-date"><b>{formatDayKey(d.date, { day: '2-digit', month: 'short' })}</b><small>{dayName(d.date)}</small></span>
            <span><b className={`att-code c-${meta.tone}`}>{meta.short || '–'}</b> {d.status === 'HOLIDAY' ? (d.holidayName || 'Holiday') : meta.label}</span>
            <span className="reg-muted">{d.shiftStart ? `${d.shiftStart}–${d.shiftEnd}` : '—'}</span>
            <span className="reg-time">{timeOf(d.checkIn)}</span>
            <span className="reg-time">{timeOf(d.checkOut)}</span>
            <span className="reg-note">{notes.length ? notes.join(' · ') : ''}</span>
            <span className="reg-action">{closed ? '' : issue && !runningToday ? 'Fix' : 'Open'}</span>
          </button>;
        })}
      </div>}
    </Card>

    {selected && <div className="side-drawer-backdrop" onClick={()=>setSelected(null)}><aside className="side-drawer regularization-drawer" onClick={(e)=>e.stopPropagation()}>
      <div className="drawer-head"><div><small>{onBehalf ? `CORRECTING ${String(selectedEmployee?.firstName || '').toUpperCase()}` : 'ATTENDANCE CORRECTION'}</small><h2>{longDate(selected.date)}</h2></div><button className="icon-close" onClick={()=>setSelected(null)}>×</button></div>
      <div className="drawer-shift-card"><span>Assigned shift</span><b>{selected.shiftName || 'No shift assigned'}</b><small>{selected.shiftStart || '—'} to {selected.shiftEnd || '—'} · grace {selected.shiftGraceMinutes || 0} min</small></div>
      <div className="drawer-facts"><div><span>Current IN</span><b>{fmtTime(selected.checkIn)}</b></div><div><span>Current OUT</span><b>{fmtTime(selected.checkOut)}</b></div><div><span>Late</span><b>{selected.lateMinutes || 0} min</b></div><div><span>Early</span><b>{selected.earlyLeaveMinutes || 0} min</b></div></div>
      <form className="drawer-form" onSubmit={apply}>
        <Field label="What needs fixing?"><select value={form.requestType} onChange={(e)=>setForm({...form,requestType:e.target.value})}><option value="ATTENDANCE_CORRECTION">Wrong or missing punch time</option><option value="LATE_IN">Permission for late arrival</option><option value="EARLY_LEAVE">Permission to leave early</option><option value="MEDICAL">Medical exception</option><option value="SPECIAL">Special permission</option></select></Field>
        {form.requestType==='ATTENDANCE_CORRECTION' ? <>
          {/* Calendar for the date, clock for the time: nothing to type. */}
          <DateTimeField label="Correct check-in" value={form.requestedCheckIn} onChange={(v)=>setForm({...form,requestedCheckIn:v})} minDate={addDaysToKey(selected.date,-1)} maxDate={selected.date} defaultDate={selected.date} defaultTime={selected.shiftStart || '09:30'} timeSuggestions={selected.shiftStart ? [{ label: 'Shift start', value: selected.shiftStart }] : []} clearable />
          <DateTimeField label="Correct check-out" value={form.requestedCheckOut} onChange={(v)=>setForm({...form,requestedCheckOut:v})} minDate={selected.date} maxDate={addDaysToKey(selected.date,1)} defaultDate={selected.date} defaultTime={selected.shiftEnd || '18:30'} timeSuggestions={selected.shiftEnd ? [{ label: 'Shift end', value: selected.shiftEnd }] : []} clearable />
        </> : <>
          <div className="permission-explainer"><b>No punch will be rewritten.</b><span>This approval is evaluated by the attendance rule engine against the employee's actual punches and monthly permission allowance.</span></div>
          <Field label="Permission minutes"><input type="number" min="0" value={form.requestedMinutes} onChange={(e)=>setForm({...form,requestedMinutes:Number(e.target.value)})}/></Field>
        </>}
        <Field label="Reason"><textarea rows="4" required value={form.reason} onChange={(e)=>setForm({...form,reason:e.target.value})} placeholder="Explain why this day needs correction or permission"/></Field>
        {onBehalf && canApprove && <label className="approve-now"><input type="checkbox" checked={approveNow} onChange={(e)=>setApproveNow(e.target.checked)}/><span><b>Approve now</b><small>You are correcting {selectedEmployee?.firstName || 'this employee'}'s attendance, so it is approved immediately and the day is recalculated. Untick to send it to their manager instead.</small></span></label>}
        <button className="primary drawer-primary">{willAutoApprove ? 'Save & approve' : 'Send for approval'}</button>
      </form>
    </aside></div>}

    <Card title="Requests & approval inbox">
      {!data?.requests?.length ? <Empty>No regularization requests yet.</Empty> : <div className="request-cards premium-requests">{data.requests.map((r)=><article key={r._id}><div><b>{r.employeeId?.employeeCode} · {r.employeeId?.firstName} {r.employeeId?.lastName}</b><span>{formatDate(r.date, { weekday:'short', day:'2-digit', month:'short' })} · {prettyStatus(r.requestType || 'ATTENDANCE_CORRECTION')}</span><p>{r.reason || 'No reason provided'}</p></div><span className={`status-pill ${String(r.status).toLowerCase()}`}>{r.status}</span>{canApprove && r.status === 'PENDING' && <div className="request-actions"><button className="approve-btn" onClick={()=>decide(r._id,'APPROVED')}>Approve</button><button className="reject-btn" onClick={()=>decide(r._id,'REJECTED')}>Reject</button></div>}</article>)}</div>}
    </Card>
  </div>;
}
