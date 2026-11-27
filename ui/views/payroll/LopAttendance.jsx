import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, post } from '../../api/client.js';
import { formatPunch } from '../../utils/time.js';

/**
 * One person's month from the payroll sheet's LOP cell: every day with its
 * status and LOP, and one click to make a day present, a half day or absent,
 * or to undo an HR change. Each change goes through the attendance calendar's
 * day actions (same checks and audit trail), and a draft payroll follows at
 * once. Keys: arrows move between days, P / H / A / U act on the chosen day.
 */

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const STATUS_TEXT = {
  PRESENT: 'Present', ABSENT: 'Absent', HALF_DAY: 'Half day', WFH: 'Work from home', HOLIDAY: 'Holiday', WEEK_OFF: 'Weekly off',
  LEAVE: 'On leave', UPCOMING: 'Not yet', NOT_MARKED: 'Not marked', IN_PROGRESS: 'At work now', REVIEW: 'Out time missing', NOT_JOINED: 'Before joining'
};
const lopText = (v) => (Number(v) === 0.5 ? '½' : String(Number(v || 0)));
const monthTitle = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayTitle = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Why a day can't be marked from here (leave, holiday… are changed elsewhere), or '' when it can. */
function lockedReason(day) {
  if (!day) return '';
  if (day.status === 'UPCOMING') return 'This day has not happened yet.';
  if (day.status === 'NOT_JOINED') return 'This is before the joining date.';
  if (day.status === 'LEAVE' || day.leaveType) return `On ${day.leaveType || 'leave'}. Cancel or change the leave from the Leave page first.`;
  if (day.status === 'WFH') return 'Work from home. Change it from the Leave page first.';
  if (day.isHoliday && !day.workedOnHoliday) return `${day.holidayName || 'Holiday'}: a paid holiday.`;
  return '';
}

export default function LopAttendance({ employee, month, released, canChange, onClose, onChanged }) {
  const [cal, setCal] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState('');
  const [reason, setReason] = useState('');
  const changed = useRef(false);
  const boxRef = useRef(null);

  useEffect(() => {
    let live = true;
    api(`/attendance/calendar?employeeId=${employee.employeeId}&month=${month}`)
      .then((data) => {
        if (!live) return;
        setCal(data);
        const first = (data.days || []).find((d) => Number(d.lopDays) > 0) || (data.days || []).find((d) => d.status !== 'UPCOMING');
        setPicked(first?.date || '');
      })
      .catch((err) => live && setError(err.message || 'Could not load the attendance'));
    return () => { live = false; };
  }, [employee.employeeId, month]);

  useEffect(() => { boxRef.current?.focus(); }, [cal]);

  const days = cal?.days || [];
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const day = byDate.get(picked);
  const lead = days.length ? (days[0].weekday + 6) % 7 : 0;
  const locked = lockedReason(day);

  function close() {
    onClose(changed.current);
    if (changed.current) onChanged?.();
  }

  async function act(kind) {
    if (!day || !canChange || locked || busy) return;
    if (kind === 'UNDO' && !day.canUndoHrChange) return;
    setBusy(kind);
    setError('');
    try {
      const body = kind === 'UNDO'
        ? { action: 'UNDO', employeeId: employee.employeeId, date: day.date, reason: reason.trim() || undefined }
        : { action: 'MARK', status: kind, employeeId: employee.employeeId, date: day.date, reason: reason.trim() || undefined };
      const res = await post('/attendance/day-action', body, { toast: false });
      setCal((c) => ({ ...c, summary: res.summary || c.summary, days: c.days.map((d) => (d.date === day.date && res.day ? res.day : d)) }));
      setResult(res.message || 'Saved.');
      changed.current = true;
    } catch (err) {
      setError(err.message || 'Could not change this day');
    } finally {
      setBusy('');
    }
  }

  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') { e.stopPropagation(); boxRef.current?.focus(); } return; }
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (move !== undefined && days.length) {
      e.preventDefault();
      const i = Math.max(0, days.findIndex((d) => d.date === picked));
      const next = days[Math.min(days.length - 1, Math.max(0, i + move))];
      if (next) setPicked(next.date);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    const key = e.key.toLowerCase();
    if (key === 'p') { e.preventDefault(); act('PRESENT'); }
    if (key === 'h') { e.preventDefault(); act('HALF_DAY'); }
    if (key === 'a') { e.preventDefault(); act('ABSENT'); }
    if (key === 'u') { e.preventDefault(); act('UNDO'); }
  }

  return (
    <div className="psheet-pop-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <section className="psheet-pop" role="dialog" aria-label={`Attendance of ${employee.name}, ${monthTitle(month)}`} tabIndex={-1} ref={boxRef} onKeyDown={onKeyDown}>
        <header>
          <div>
            <small>ATTENDANCE · {monthTitle(month).toUpperCase()}</small>
            <h3>{employee.name} <span>{employee.employeeCode}</span></h3>
          </div>
          <div className="psheet-pop-lop" aria-live="polite">
            <span>LOP this month</span>
            <b>{cal ? `${cal.summary?.lopDays ?? 0} day${Number(cal.summary?.lopDays) === 1 ? '' : 's'}` : '…'}</b>
          </div>
          <button type="button" className="psheet-icon" onClick={close} aria-label="Close"><Icon name="X" size={17} /></button>
        </header>
        {released && <p className="psheet-pop-warn"><Icon name="Lock" size={14} /> {monthTitle(month)} payroll is released, so a change here does not change the payslip. Change the amounts in the sheet if the payslip must change too.</p>}
        {!canChange && <p className="psheet-pop-warn"><Icon name="Lock" size={14} /> You can see the days but not change attendance. Please contact your administrator / HR.</p>}
        {error && <p className="psheet-pop-error">{error}</p>}
        {!cal && !error && <p className="psheet-pop-loading"><Icon name="Loader2" size={15} className="spin" /> Loading the month…</p>}
        {cal && (
          <>
            <div className="psheet-cal" role="grid" aria-label="Days of the month">
              {WEEK.map((w) => <div key={w} className="psheet-cal-head" role="columnheader">{w}</div>)}
              {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} className="psheet-cal-blank" />)}
              {days.map((d) => (
                <button
                  type="button"
                  key={d.date}
                  role="gridcell"
                  className={`psheet-day st-${String(d.status).toLowerCase()}${d.date === picked ? ' picked' : ''}${Number(d.lopDays) > 0 ? ' has-lop' : ''}${d.hrChanged ? ' hr' : ''}`}
                  onClick={() => setPicked(d.date)}
                  onDoubleClick={() => setPicked(d.date)}
                  aria-label={`${dayTitle(d.date)}: ${STATUS_TEXT[d.status] || d.status}${Number(d.lopDays) > 0 ? `, ${lopText(d.lopDays)} LOP` : ''}`}
                  aria-selected={d.date === picked}
                >
                  <span className="n">{d.day}</span>
                  <span className="l">{d.letter}</span>
                  {Number(d.lopDays) > 0 && <span className="lop">{lopText(d.lopDays)}</span>}
                </button>
              ))}
            </div>
            {day && (
              <div className="psheet-daycard">
                <div className="psheet-daycard-top">
                  <b>{dayTitle(day.date)}</b>
                  <span>{STATUS_TEXT[day.status] || day.status}{day.holidayName ? ` · ${day.holidayName}` : ''}{Number(day.lopDays) > 0 ? ` · ${lopText(day.lopDays)} day LOP` : ' · no LOP'}{day.hrChanged ? ' · changed by HR' : ''}</span>
                  <small>{day.checkIn ? `In ${formatPunch(day.checkIn)}` : 'No in punch'}{day.checkOut ? ` · Out ${formatPunch(day.checkOut)}` : day.checkIn ? ' · no out punch' : ''}{day.shiftName ? ` · ${day.shiftName}` : ''}</small>
                </div>
                {locked ? <p className="psheet-daycard-locked">{locked}</p> : (
                  <>
                    <div className="psheet-daycard-actions">
                      <button type="button" className="secondary" disabled={!canChange || Boolean(busy)} onClick={() => act('PRESENT')}><b>P</b><span className="t">Present<small>no LOP</small></span></button>
                      <button type="button" className="secondary" disabled={!canChange || Boolean(busy)} onClick={() => act('HALF_DAY')}><b>H</b><span className="t">Half day<small>½ day LOP</small></span></button>
                      <button type="button" className="secondary" disabled={!canChange || Boolean(busy)} onClick={() => act('ABSENT')}><b>A</b><span className="t">Absent<small>1 day LOP</small></span></button>
                      {day.canUndoHrChange && <button type="button" className="secondary" disabled={!canChange || Boolean(busy)} onClick={() => act('UNDO')}><b>U</b><span className="t">Undo<small>HR change</small></span></button>}
                    </div>
                    <input className="psheet-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, saved in the audit log)" aria-label="Reason" />
                  </>
                )}
              </div>
            )}
            {result && <p className="psheet-pop-result" aria-live="polite"><Icon name="CheckCircle2" size={14} /> {result}</p>}
          </>
        )}
        <footer>
          <span>Arrows: day · <kbd>P</kbd> present · <kbd>H</kbd> half day · <kbd>A</kbd> absent · <kbd>U</kbd> undo · <kbd>Esc</kbd> close</span>
          <button type="button" className="primary" onClick={close}>Done</button>
        </footer>
      </section>
    </div>
  );
}
