import React from 'react';
import { formatTime, durationLabel } from '../../utils/time.js';
import { statusMeta, WEEKDAYS, isIssue, LEAVE_NAMES } from './meta.js';

function codeFor(day) {
  if (day.workedOnHoliday) return { code: 'P', tone: 'present' };
  if (day.status === 'LEAVE' && day.dayPart && day.dayPart !== 'FULL') return { code: 'HL', tone: 'leave' };
  const m = statusMeta(day.status);
  return { code: m.short, tone: m.tone };
}

function DayCell({ day, onOpen }) {
  const meta = statusMeta(day.status);
  const disabled = ['UPCOMING', 'NOT_JOINED'].includes(day.status) && !day.pendingLeave;
  const worked = Number(day.workedMinutes || 0);
  const shiftMinutes = Number(day.shiftMinutes || 480);
  // The server already leaves out arrivals inside the grace (10:14:59 on a 10:00 shift is on time).
  const late = Number(day.lateMinutes) > 0 ? Number(day.lateMinutes) : 0;
  const overtime = worked > shiftMinutes + 30 ? worked - shiftMinutes : 0;
  const { code, tone } = codeFor(day);
  const classes = ['att-day', `t-${tone}`];
  if (day.isToday) classes.push('is-today');
  if (isIssue(day)) classes.push('has-issue');

  let caption = '';
  if (day.status === 'REVIEW') caption = day.missingSide === 'IN' ? 'In time missing' : 'Out time missing';
  else if (day.status === 'HOLIDAY' || day.workedOnHoliday) caption = day.holidayName || 'Holiday';
  else if (day.status === 'LEAVE') caption = LEAVE_NAMES[day.leaveType] || 'On leave';
  else if (day.status === 'WEEK_OFF') caption = 'Weekly off';
  else if (day.status === 'ABSENT' && !day.checkIn && !day.missingPunch) caption = 'No punch';
  else if (day.status === 'NOT_MARKED') caption = day.shiftStart ? `Shift ${day.shiftStart}–${day.shiftEnd}` : 'Not marked yet';
  else if (day.status === 'UPCOMING' && day.pendingLeave) caption = `${LEAVE_NAMES[day.pendingLeave] || day.pendingLeave} requested`;
  else if (day.status === 'WFH' && !day.checkIn) caption = 'Work from home';

  const notes = [];
  if (late > 0) notes.push({ k: 'late', t: `Late ${late}m` });
  if (Number(day.earlyLeaveMinutes) > 0) notes.push({ k: 'early', t: `Left ${day.earlyLeaveMinutes}m early` });
  if (day.status === 'REVIEW') notes.push({ k: 'review', t: 'Needs a decision' });
  else if (day.missingPunch) notes.push({ k: 'miss', t: 'Missing punch' });
  if (Number(day.lopDays) > 0 && !['UPCOMING', 'NOT_JOINED'].includes(day.status)) notes.push({ k: 'lop', t: `${day.lopDays} LOP` });
  if (overtime > 0) notes.push({ k: 'ot', t: `+${durationLabel(overtime, { short: true })} extra` });
  if ((day.pendingRegularization || day.pendingLeave) && day.status !== 'UPCOMING') notes.push({ k: 'pending', t: 'Request pending' });

  const label = `${day.date}: ${meta.label}${day.checkIn ? `, in ${formatTime(day.checkIn)}` : ''}${day.checkOut ? `, out ${formatTime(day.checkOut)}` : ''}`;

  return (
    <button type="button" className={classes.join(' ')} onClick={() => onOpen(day)} disabled={disabled} aria-label={label} title={label}>
      <div className="att-day-top">
        <span className="att-day-num">{day.day}</span>
        {code && <span className={`att-code c-${tone}`}>{code}</span>}
      </div>
      {(day.checkIn || day.checkOut) && (
        <div className="att-times">{formatTime(day.checkIn)} – {day.checkOut ? formatTime(day.checkOut) : day.status === 'IN_PROGRESS' ? 'now' : day.status === 'REVIEW' ? '?' : '—'}</div>
      )}
      {caption && <div className="att-day-caption">{caption}</div>}
      {worked > 0 && !notes.length && <div className="att-day-hours">{durationLabel(worked, { short: true })}</div>}
      {notes.length > 0 && (
        <div className="att-notes">
          {notes.slice(0, 2).map((n) => <span key={n.k} className={`att-note n-${n.k}`}>{n.t}</span>)}
        </div>
      )}
    </button>
  );
}

export default function MonthCalendar({ days = [], loading, onOpen, showWfh }) {
  const blanks = days.length ? days[0].weekday : 0;
  const legend = [
    ['PRESENT', 'Present'], ['ABSENT', 'Absent'], ['HALF_DAY', 'Half day'], ['REVIEW', 'Out time missing (no LOP yet)'], ['LEAVE', 'Leave'],
    ...(showWfh ? [['WFH', 'Work from home']] : []), ['HOLIDAY', 'Holiday'], ['WEEK_OFF', 'Weekly off']
  ];
  return (
    <>
      <div className="att-legend">
        {legend.map(([key, label]) => <span key={key}><b className={`att-code c-${statusMeta(key).tone}`}>{statusMeta(key).short}</b>{label}</span>)}
        <span><b className="att-legend-note">Late</b>Orange note = needs attention</span>
      </div>
      <div className="att-cal">
        <div className="att-cal-grid" role="grid" aria-label="Attendance calendar">
          {WEEKDAYS.map((d) => <div key={d} className="att-cal-head" role="columnheader">{d}</div>)}
          {loading && !days.length
            ? Array.from({ length: 35 }).map((_, i) => <div key={i} className="att-skeleton" />)
            : <>
              {Array.from({ length: blanks }).map((_, i) => <div key={`b${i}`} className="att-cal-blank" aria-hidden="true" />)}
              {days.map((day) => <DayCell key={day.date} day={day} onOpen={onOpen} />)}
            </>}
        </div>
      </div>
    </>
  );
}
