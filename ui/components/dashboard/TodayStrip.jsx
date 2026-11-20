import React, { useCallback, useEffect, useState } from 'react';
import { Link } from '../../lib/router.jsx';
import Icon from '../Icon.jsx';
import { api, post } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { GeminiBadge, AiSetupHint, useAiStatus } from '../AiKit.jsx';
import { currentMonthKey, durationLabel, formatDayKey, initialsOf, todayKey } from '../../utils/time.js';
import '../../styles/attendance.css';
import '../../styles/v26.css';

/**
 * The "today" row above the customisable widget grid: a Gemini morning
 * briefing, live attendance for the people in scope (or the employee's own
 * month), and birthdays / anniversaries / holidays in the next 7 days.
 */
export default function TodayStrip({ user, summary }) {
  const teamView = user?.role && user.role !== 'EMPLOYEE';
  return (
    <div className="dash-today">
      <Briefing user={user} />
      {teamView ? <TeamToday /> : <MyMonth />}
      <ThisWeek holidays={summary?.upcomingHolidays || []} />
    </div>
  );
}

/* ---------------------------------------------------------------- */
function cacheKey(user) {
  return `hrms.briefing.${user?._id || user?.id || 'me'}.${todayKey()}`;
}

export function Briefing({ user }) {
  const status = useAiStatus();
  const [state, setState] = useState(() => {
    try {
      const cached = sessionStorage.getItem(cacheKey(user));
      return { loading: !cached, data: cached ? JSON.parse(cached) : null, error: '' };
    } catch (_) { return { loading: true, data: null, error: '' }; }
  });

  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await post('/ai/briefing', {}, { toast: false });
      setState({ loading: false, data, error: '' });
      try { sessionStorage.setItem(cacheKey(user), JSON.stringify(data)); } catch (_) { /* private mode */ }
    } catch (err) {
      setState((s) => ({ loading: false, data: s.data, error: err.message }));
    }
  }, [user]);

  useEffect(() => { if (!state.data) run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const d = state.data;
  return (
    <section className="dash-today-card briefing">
      <header>
        <span className="ai-orb"><Icon name="Sparkles" size={16} /></span>
        <div>
          <small>TODAY'S BRIEFING</small>
          <h3>{d?.headline || (state.loading ? 'Reading today’s records…' : 'Your day at a glance')}</h3>
        </div>
        <div className="dash-today-actions">
          {d && <GeminiBadge used={d.usedAi} model={d.model} compact />}
          <button type="button" className="ai-run" onClick={run} disabled={state.loading} title="Refresh briefing"><Icon name="RefreshCw" size={14} /></button>
        </div>
      </header>
      {state.loading && !d && <div className="ai-shimmer"><span style={{ width: '92%' }} /><span style={{ width: '78%' }} /><span style={{ width: '64%' }} /></div>}
      {state.error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {state.error}</p>}
      {d && (
        <>
          {d.bullets?.length ? <ul className="ai-bullets">{d.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul> : <p className="ai-idle">Nothing needs your attention right now.</p>}
          {d.focus && <p className="dash-focus"><Icon name="Target" size={14} /> <span><b>Focus:</b> {d.focus}</span></p>}
          {!d.usedAi && <AiSetupHint status={status} />}
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- */
export function TeamToday() {
  const { data, error, loading } = useApi('/attendance/team-today', []);
  const s = data?.summary;
  const total = Math.max(1, (s?.total || 0) - (s?.off || 0));
  const segments = s ? [
    { key: 'ontime', label: 'On time', value: Math.max(0, (s.present || 0) - (s.late || 0)), tone: 'good' },
    { key: 'late', label: 'Late', value: s.late || 0, tone: 'warn' },
    { key: 'leave', label: 'On leave', value: (s.onLeave || 0) + (s.wfh || 0), tone: 'info' },
    { key: 'notyet', label: 'Not in', value: (s.notYet || 0) + (s.missing || 0), tone: 'bad' }
  ] : [];
  return (
    <section className="dash-today-card">
      <header>
        <span className="dash-today-icon teal"><Icon name="Users" size={16} /></span>
        <div><small>TEAM TODAY</small><h3>{s ? `${s.present || 0} of ${total} in` : 'Attendance today'}</h3></div>
        <div className="dash-today-actions"><Link className="dash-link" to="/attendance#team">Open board <Icon name="ArrowRight" size={13} /></Link></div>
      </header>
      {loading && !data && <div className="ai-shimmer"><span style={{ width: '90%' }} /><span style={{ width: '60%' }} /></div>}
      {error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {error.message}</p>}
      {s && (
        <>
          <div className="dash-meter" role="img" aria-label="Attendance split today">
            {segments.filter((x) => x.value > 0).map((x) => <span key={x.key} className={x.tone} style={{ flexGrow: x.value }} title={`${x.label}: ${x.value}`} />)}
            {!segments.some((x) => x.value > 0) && <span className="empty" style={{ flexGrow: 1 }} />}
          </div>
          <div className="dash-legend">
            {segments.map((x) => <div key={x.key}><i className={x.tone} /><b>{x.value}</b><span>{x.label}</span></div>)}
          </div>
          {(() => {
            const rows = data?.rows || [];
            const late = rows.filter((r) => r.lateMinutes > 0 && ['IN', 'DONE'].includes(r.state));
            const waiting = rows.filter((r) => ['NOT_YET', 'MISSING'].includes(r.state));
            const pick = waiting.length ? { label: data?.isToday ? 'Not in yet' : 'Absent', list: waiting } : late.length ? { label: 'Late', list: late } : null;
            if (!pick) return null;
            return (
              <div className="dash-names">
                <small>{pick.label}</small>
                {pick.list.slice(0, 4).map((r) => <span key={r.employeeId} title={r.employeeCode}>{r.name.split(' ')[0]}{pick.label === 'Late' ? ` · ${r.lateMinutes}m` : ''}</span>)}
                {pick.list.length > 4 && <span className="more">+{pick.list.length - 4}</span>}
              </div>
            );
          })()}
          {s.off > 0 && <small className="dash-sub">{s.off} on weekly off or holiday today</small>}
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- */
export function MyMonth() {
  const month = currentMonthKey();
  const { data, error, loading } = useApi(`/attendance/calendar?month=${month}`, [month]);
  const s = data?.summary;
  const today = (data?.days || []).find((d) => d.date === data?.today);
  return (
    <section className="dash-today-card">
      <header>
        <span className="dash-today-icon teal"><Icon name="CalendarCheck" size={16} /></span>
        <div><small>MY ATTENDANCE · THIS MONTH</small><h3>{s ? `${s.attendanceRate ?? 0}% attendance` : 'This month'}</h3></div>
        <div className="dash-today-actions"><Link className="dash-link" to="/attendance">Open <Icon name="ArrowRight" size={13} /></Link></div>
      </header>
      {loading && !data && <div className="ai-shimmer"><span style={{ width: '90%' }} /><span style={{ width: '60%' }} /></div>}
      {error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {error.message}</p>}
      {s && (
        <>
          <div className="dash-legend four">
            {/* summary.present already includes WFH days */}
            <div><i className="good" /><b>{s.present}</b><span>Present</span></div>
            <div><i className="warn" /><b>{s.lateDays}</b><span>Late</span></div>
            <div><i className="info" /><b>{s.leaveDays}</b><span>Leave</span></div>
            <div><i className="bad" /><b>{s.missingPunches}</b><span>Missed</span></div>
          </div>
          <small className="dash-sub">
            {today?.checkIn ? `Today: in at ${new Date(today.checkIn).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}${today.workedMinutes ? ` · ${durationLabel(today.workedMinutes, { short: true })} so far` : ''}` : 'You have not checked in today.'}
            {s.avgCheckIn ? ` · Avg arrival ${s.avgCheckIn}` : ''}
          </small>
        </>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- */
export function ThisWeek({ holidays }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api('/employees/birthdays?upcoming=7', { toast: false })
      .then((r) => { if (alive) setData(r); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  const today = todayKey();
  const limit = (() => { const [y, m, d] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10); })();
  const items = [
    ...(data?.birthdays || []).map((p) => ({ key: `b${p.id}`, kind: 'birthday', name: p.name, days: p.daysAway, sub: p.isToday ? 'Birthday today' : `Birthday ${p.daysAway === 1 ? 'tomorrow' : `in ${p.daysAway} days`}` })),
    ...(data?.anniversaries || []).map((p) => ({ key: `a${p.id}`, kind: 'anniv', name: p.name, days: p.daysAway, sub: `${p.years} year${p.years === 1 ? '' : 's'} at work${p.isToday ? ' today' : ` in ${p.daysAway} day${p.daysAway === 1 ? '' : 's'}`}` })),
    ...holidays.map((h) => {
      const key = String(h.date || '').slice(0, 10);
      if (!key || key < today || key > limit) return null;
      const [y, m, d] = today.split('-').map(Number);
      const [yy, mm, dd] = key.split('-').map(Number);
      const days = Math.round((Date.UTC(yy, mm - 1, dd) - Date.UTC(y, m - 1, d)) / 86400000);
      return { key: `h${h._id || key}`, kind: 'holiday', name: h.name, days, sub: `${formatDayKey(key, { weekday: 'short', day: 'numeric', month: 'short' })} · holiday` };
    }).filter(Boolean)
  ].sort((a, b) => a.days - b.days);
  const shown = items.slice(0, 3);

  return (
    <section className="dash-today-card">
      <header>
        <span className="dash-today-icon rose"><Icon name="Cake" size={16} /></span>
        <div><small>NEXT 7 DAYS</small><h3>{items.length ? `${items.length} thing${items.length === 1 ? '' : 's'} to celebrate` : 'A quiet week'}</h3></div>
        <div className="dash-today-actions"><Link className="dash-link" to="/birthdays">Send wishes <Icon name="ArrowRight" size={13} /></Link></div>
      </header>
      {!data && !error && <div className="ai-shimmer"><span style={{ width: '80%' }} /><span style={{ width: '66%' }} /></div>}
      {error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {error}</p>}
      {data && !items.length && <p className="ai-idle">No birthdays, work anniversaries or holidays this week.</p>}
      <div className="dash-people">
        {shown.map((x) => (
          <div key={x.key} className={`dash-person ${x.kind} ${x.days === 0 ? 'today' : ''}`}>
            <span className="dash-avatar">{x.kind === 'holiday' ? <Icon name="Sun" size={15} /> : initialsOf(x.name)}</span>
            <div><b>{x.name}</b><small>{x.sub}</small></div>
            {x.days === 0 && <em>Today</em>}
          </div>
        ))}
        {items.length > shown.length && <Link className="dash-link" to="/birthdays">+{items.length - shown.length} more this week</Link>}
      </div>
    </section>
  );
}
