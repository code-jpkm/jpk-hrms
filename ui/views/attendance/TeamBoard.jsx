import React, { useMemo, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { useApi } from '../../hooks/useApi.js';
import { post } from '../../api/client.js';
import { formatTime, durationLabel, formatDayKey, todayKey, initialsOf } from '../../utils/time.js';
import { TEAM_STATES, LEAVE_NAMES, downloadCsv } from './meta.js';

const FILTERS = [
  ['ALL', 'Everyone', '#1F3445', (s) => s.total],
  ['PRESENT', 'Present', '#1F3445', (s) => s.present],
  ['IN', 'On duty', '#1F3445', (s) => s.in],
  ['LATE', 'Late', '#F38121', (s) => s.late],
  ['MISSING', 'Not in', '#F38121', (s) => s.missing],
  ['NOT_YET', 'Shift later', '#5D7284', (s) => s.notYet],
  ['LEAVE', 'On leave', '#1F3445', (s) => s.onLeave + s.wfh],
  ['OFF', 'Off today', '#807F84', (s) => s.off]
];

function matches(row, filter) {
  if (filter === 'ALL') return true;
  if (filter === 'PRESENT') return ['IN', 'DONE'].includes(row.state);
  if (filter === 'LATE') return row.lateMinutes > 0;
  if (filter === 'MISSING') return ['MISSING', 'ABSENT'].includes(row.state);
  if (filter === 'LEAVE') return ['LEAVE', 'WFH'].includes(row.state);
  if (filter === 'OFF') return ['HOLIDAY', 'WEEK_OFF'].includes(row.state);
  return row.state === filter;
}

export default function TeamBoard({ location, canMessage, onOpenPerson }) {
  const [date, setDate] = useState(todayKey());
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const path = `/attendance/team-today?date=${date}${location && location !== 'ALL' ? `&location=${location}` : ''}`;
  const { data, loading, error, reload } = useApi(path, [path], { skeleton: false });
  const rows = data?.rows || [];
  const summary = data?.summary || { total: 0, present: 0, in: 0, late: 0, missing: 0, notYet: 0, onLeave: 0, wfh: 0, off: 0, done: 0 };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => matches(r, filter)).filter((r) => !q || `${r.name} ${r.employeeCode} ${r.department}`.toLowerCase().includes(q));
  }, [rows, filter, query]);

  const missing = rows.filter((r) => r.state === 'MISSING');

  async function remind() {
    if (!missing.length) return;
    setSending(true);
    try {
      await post('/messages/broadcast', {
        audience: { type: 'SELECTED', employeeIds: missing.map((r) => r.employeeId) },
        subject: 'Attendance reminder',
        message: `Hello, we have not received your check-in for ${formatDayKey(date, { day: 'numeric', month: 'short' })}. If you are on duty, please punch in now or raise a regularization from the HRMS. If you are on leave, please apply for it.`,
        channels: { email: false, whatsapp: true, inApp: true }
      }, { loadingMessage: `Reminding ${missing.length} people…` });
    } catch (_) { /* toast already shown */ } finally { setSending(false); }
  }

  function exportCsv() {
    downloadCsv(`team-attendance-${date}.csv`, ['Code', 'Name', 'Department', 'Location', 'Status', 'Check in', 'Check out', 'Late (min)', 'Worked', 'Shift'],
      visible.map((r) => [r.employeeCode, r.name, r.department, r.workLocation, TEAM_STATES[r.state]?.label || r.state, r.checkIn ? formatTime(r.checkIn) : '', r.checkOut ? formatTime(r.checkOut) : '', r.lateMinutes || '', r.workedMinutes ? durationLabel(r.workedMinutes) : '', r.shiftName]));
  }

  return (
    <div className="att-team">
      <div className="att-team-tools">
        <div className="att-team-chips">
          {FILTERS.map(([key, label, dot, get]) => (
            <button type="button" key={key} className={`att-team-chip ${filter === key ? 'active' : ''}`} onClick={() => setFilter(key)}>
              <i style={{ '--dot': dot }} /> {label} <b>{get(summary) || 0}</b>
            </button>
          ))}
        </div>
        <div className="att-toolbar">
          <input type="date" className="att-icon-btn" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || todayKey())} aria-label="Board date" />
          <button type="button" className="att-icon-btn" onClick={() => reload()}><Icon name="RefreshCw" size={14} /> Refresh</button>
          <button type="button" className="att-icon-btn" onClick={exportCsv}><Icon name="Download" size={14} /> CSV</button>
          {canMessage && data?.isToday && missing.length > 0 && (
            <button type="button" className="att-icon-btn" onClick={remind} disabled={sending} style={{ color: '#B85C10', borderColor: '#E1E1E4' }}>
              <Icon name="BellRing" size={14} /> {sending ? 'Sending…' : `Remind ${missing.length} not in`}
            </button>
          )}
        </div>
      </div>
      <label className="att-search"><Icon name="Search" size={15} /><input placeholder="Search name, code or department" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      {error && <div className="att-alert"><Icon name="TriangleAlert" size={16} /><div>{error.message}</div></div>}
      {loading && !rows.length ? (
        <div className="att-people">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="att-skeleton" style={{ minHeight: 150 }} />)}</div>
      ) : !visible.length ? (
        <div className="att-empty">No one matches this view.</div>
      ) : (
        <div className="att-people">
          {visible.map((r) => {
            const st = TEAM_STATES[r.state] || { label: r.state, dot: '#807F84' };
            return (
              <article key={r.employeeId} className={`att-person st-${r.state}`}>
                <div className="att-person-top">
                  <span className="att-avatar">{initialsOf(r.name)}</span>
                  <div><b>{r.name}</b><small>{r.employeeCode} · {r.department || r.designation || r.workLocation}</small></div>
                  <span className="att-pill" style={{ '--pill': st.dot, '--pill-soft': `${st.dot}1f`, background: `${st.dot}1f`, color: st.dot }}>{r.state === 'LEAVE' ? (LEAVE_NAMES[r.leaveType] || 'Leave') : r.state === 'HOLIDAY' ? r.holidayName || 'Holiday' : st.label}</span>
                </div>
                <div className="att-person-meta">
                  <div><span>In</span><b>{r.checkIn ? formatTime(r.checkIn) : '—'}</b></div>
                  <div><span>Out</span><b>{r.checkOut ? formatTime(r.checkOut) : r.state === 'IN' ? 'On duty' : '—'}</b></div>
                  <div><span>Worked</span><b>{r.workedMinutes ? durationLabel(r.workedMinutes, { short: true }) : '—'}</b></div>
                </div>
                <div className="att-person-foot">
                  <span>{r.lateMinutes ? <b style={{ color: '#B85C10' }}>{r.lateMinutes} min late</b> : r.shiftStart ? `Shift ${r.shiftStart}–${r.shiftEnd}` : r.shiftName || 'No shift'}</span>
                  <button type="button" className="att-link" onClick={() => onOpenPerson(r.employeeId)}>Open calendar →</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
