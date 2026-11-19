import React, { useState } from 'react';
import { Link } from '../lib/router.jsx';
import Icon from '../components/Icon.jsx';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { canAccessPath } from '../utils/permissions.js';
import { defaultFavouriteIds, usableQuickActions } from '../utils/nav.js';
import { clockLabel, durationLabel, formatDayKey, formatTime, todayKey } from '../utils/time.js';
import DayScene, { PERIOD_ICON, greetingAt, periodLine } from '../components/DayScene.jsx';
import WeatherBadge from '../components/WeatherBadge.jsx';
import { weatherIcon } from '../utils/weather.js';
import { punchNow } from '../utils/punch.js';
import { TeamToday } from '../components/dashboard/TodayStrip.jsx';
import '../styles/v26.css';
import '../styles/home.css';

const LEAVE_NAMES = { EL: 'Earned leave', CL: 'Casual leave', SL: 'Sick leave', COMP_OFF: 'Comp off', ML: 'Maternity leave', PL: 'Paternity leave' };

/**
 * Home: what a person needs today, in plain words — their attendance, leave
 * balance, anything waiting for them, holidays, shortcuts and announcements.
 */
export default function Home() {
  const { user, employee } = useAuth();
  const role = String(user?.role || '').toUpperCase();
  const isEmployee = role === 'EMPLOYEE';
  const firstName = (user?.name || employee?.firstName || '').split(' ')[0];
  const { data: summary } = useApi('/dashboard/summary', []);
  const { data: notices } = useApi('/notices', []);

  const shortcuts = usableQuickActions(user, defaultFavouriteIds(user)).slice(0, 8);
  const updates = [
    ...(notices?.notices || []).filter((n) => n.pinned).map((n) => ({ id: n._id, icon: 'Megaphone', title: n.title, body: n.body, when: n.createdAt, link: '/notices' })),
    ...(summary?.smartUpdates || []).map((u, i) => ({ id: `s${i}`, icon: u.type === 'HOLIDAY' ? 'CalendarDays' : u.type === 'ANNIVERSARY' ? 'Award' : 'Cake', title: u.title.replace(/^[^\w(]+\s*/u, ''), body: u.body, daysAway: u.daysAway, link: u.type === 'HOLIDAY' ? '/holidays' : '/birthdays' })),
    ...(notices?.notices || []).filter((n) => !n.pinned).map((n) => ({ id: n._id, icon: 'Megaphone', title: n.title, body: n.body, when: n.createdAt, link: '/notices' }))
  ].slice(0, 6);
  const holidays = (summary?.upcomingHolidays || []).slice(0, 4);

  return (
    <div className="home">
      <section className="home-hero">
        <DayScene variant="hero" className="home-hero-scene">
          {({ period, minutes, times, weather }) => (
            <div className="home-hero-copy">
              <span className="home-hero-time">
                {/* No bright sun on the clock when it is grey or raining outside. */}
                <Icon name={PERIOD_ICON[period] === 'Sun' && weather?.data?.now && weather.data.now.kind !== 'clear' ? weatherIcon(weather.data.now, period) : PERIOD_ICON[period]} size={14} />
                {clockLabel(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`)}
                <i aria-hidden="true">·</i>
                {formatDayKey(todayKey(), { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
              <h2>{greetingAt(minutes)}{firstName ? `, ${firstName}` : ''}</h2>
              <p>{periodLine(period, minutes, times)}</p>
              <WeatherBadge variant="card" period={period} />
            </div>
          )}
        </DayScene>
        {(canAccessPath(user, '/leave') || canAccessPath(user, '/regularization')) && (
          <div className="home-hero-actions">
            {canAccessPath(user, '/leave') && <Link className="home-btn" to="/leave"><Icon name="Palmtree" size={16} /> Apply leave</Link>}
            {canAccessPath(user, '/regularization') && <Link className="home-btn" to="/regularization"><Icon name="FileClock" size={16} /> Correct attendance</Link>}
          </div>
        )}
      </section>

      <div className="home-grid">
        {employee?._id && <TodayCard />}
        {employee?._id && <LeaveCard employeeId={employee._id} />}
        <WaitingCard summary={summary} isEmployee={isEmployee} user={user} />
        <HolidayCard holidays={holidays} />
      </div>

      {!isEmployee && canAccessPath(user, '/attendance') && (
        <div className="home-team"><TeamToday /></div>
      )}

      <div className="home-split">
        <section className="home-card">
          <header className="home-card-head"><h3>Quick links</h3></header>
          <div className="home-links">
            {shortcuts.map((a) => (
              <Link key={a.id} to={a.to} className="home-link">
                <span><Icon name={a.icon} size={18} /></span>
                <b>{a.label}</b>
              </Link>
            ))}
          </div>
        </section>
        <section className="home-card">
          <header className="home-card-head"><h3>Announcements</h3><Link to="/notices">View all</Link></header>
          {!updates.length && <p className="home-empty">No announcements right now.</p>}
          <ul className="home-updates">
            {updates.map((u) => (
              <li key={u.id}>
                <span className="home-update-icon"><Icon name={u.icon} size={16} /></span>
                <div>
                  <Link to={u.link}><b>{u.title}</b></Link>
                  {u.body && <p>{u.body}</p>}
                </div>
                {u.daysAway === 0 && <em>Today</em>}
                {u.daysAway === 1 && <em className="soft">Tomorrow</em>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function TodayCard() {
  const { data: state, error, reload } = useApi('/attendance/mobile-state', [], { skeleton: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const record = state?.attendance;
  const shift = state?.shift;
  const live = Boolean(record?.checkIn && !record?.checkOut);
  const worked = record?.checkIn ? Math.max(0, Math.round(((record.checkOut ? new Date(record.checkOut) : new Date()) - new Date(record.checkIn)) / 60000)) : 0;
  const canPunchHere = state?.mobile?.enabled || state?.mobile?.mode === 'WFH_ONLY';

  async function punch(mode) {
    setBusy(true); setMessage(null);
    try {
      const res = await punchNow(mode);
      setMessage({ tone: 'good', text: res?.message || (mode === 'in' ? 'Checked in.' : 'Checked out.') });
      await reload();
    } catch (err) {
      setMessage({ tone: 'bad', text: err.message });
    } finally { setBusy(false); }
  }

  let status = 'Not checked in yet';
  if (state?.completed) status = `Day complete · ${durationLabel(worked)}`;
  else if (live) status = `Checked in at ${formatTime(record.checkIn)}${state?.lateMinutes ? ` · ${state.lateMinutes} min late` : ''}`;

  return (
    <section className="home-card">
      <header className="home-card-head"><h3>Today</h3><Link to="/attendance">My attendance</Link></header>
      {error && <p className="home-note bad">{error.message}</p>}
      {!state && !error && <div className="ai-shimmer"><span style={{ width: '80%' }} /><span style={{ width: '60%' }} /></div>}
      {state && (
        <>
          <div className="home-today">
            <div>
              <small>Shift</small>
              <b>{shift ? `${clockLabel(shift.startTime)} – ${clockLabel(shift.endTime)}` : 'Not assigned'}</b>
              {shift?.name && <span>{shift.name}</span>}
            </div>
            <div>
              <small>Status</small>
              <b className={live || state.completed ? 'ok' : ''}>{status}</b>
              {record?.checkIn && <span>{record.checkOut ? `Out at ${formatTime(record.checkOut)}` : `${durationLabel(worked)} so far`}</span>}
            </div>
          </div>
          <div className="home-card-actions">
            {canPunchHere && state.canCheckIn && <button type="button" className="accent-btn home-punch" onClick={() => punch('in')} disabled={busy}><Icon name="LogIn" size={16} /> {busy ? 'Locating you…' : 'Check in'}</button>}
            {canPunchHere && state.canCheckOut && <button type="button" className="primary home-punch" onClick={() => punch('out')} disabled={busy}><Icon name="LogOut" size={16} /> {busy ? 'Locating you…' : 'Check out'}</button>}
            {!canPunchHere && !state.completed && <p className="home-note"><Icon name="Fingerprint" size={14} /> Punch on the biometric machine. It shows here automatically.</p>}
          </div>
          {message && <p className={`home-note ${message.tone}`}>{message.text}</p>}
        </>
      )}
    </section>
  );
}

function LeaveCard({ employeeId }) {
  const { data } = useApi(`/leaves/balances?employeeId=${employeeId}`, [employeeId], { skeleton: false });
  const rows = (data?.balances || []).filter((b) => b.leaveType !== 'LOP').sort((a, b) => a.leaveType.localeCompare(b.leaveType));
  return (
    <section className="home-card">
      <header className="home-card-head"><h3>Leave balance</h3><Link to="/leave">Apply leave</Link></header>
      {!data && <div className="ai-shimmer"><span style={{ width: '70%' }} /><span style={{ width: '50%' }} /></div>}
      {data && !rows.length && <p className="home-empty">No leave balance yet. HR adds it at the start of the year.</p>}
      <div className="home-balances">
        {rows.slice(0, 4).map((b) => (
          <div key={b.leaveType}>
            <b>{Number(b.available || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 })}</b>
            <span>{LEAVE_NAMES[b.leaveType] || b.leaveType}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function WaitingCard({ summary, isEmployee, user }) {
  const rows = [
    canAccessPath(user, '/leave') && { key: 'leave', icon: 'Palmtree', label: isEmployee ? 'My leave requests' : 'Leave requests', count: summary?.pendingLeaves, to: '/leave' },
    canAccessPath(user, '/regularization') && { key: 'reg', icon: 'FileClock', label: isEmployee ? 'My attendance corrections' : 'Attendance corrections', count: summary?.pendingRegularizations, to: '/regularization' }
  ].filter(Boolean);
  const total = rows.reduce((s, r) => s + Number(r.count || 0), 0);
  return (
    <section className="home-card">
      <header className="home-card-head"><h3>{isEmployee ? 'My pending requests' : 'Waiting for your approval'}</h3></header>
      {!summary && <div className="ai-shimmer"><span style={{ width: '70%' }} /><span style={{ width: '55%' }} /></div>}
      {summary && (
        <ul className="home-waiting">
          {rows.map((r) => (
            <li key={r.key}>
              <Icon name={r.icon} size={16} />
              <span>{r.label}</span>
              <b className={Number(r.count) ? 'has' : ''}>{Number(r.count || 0)}</b>
              <Link to={r.to}>{isEmployee ? 'View' : 'Review'}</Link>
            </li>
          ))}
        </ul>
      )}
      {summary && total === 0 && <p className="home-note">{isEmployee ? 'Nothing pending.' : 'All caught up. Nothing is waiting for you.'}</p>}
    </section>
  );
}

function HolidayCard({ holidays }) {
  return (
    <section className="home-card">
      <header className="home-card-head"><h3>Upcoming holidays</h3><Link to="/holidays">Calendar</Link></header>
      {!holidays.length && <p className="home-empty">No holidays coming up.</p>}
      <ul className="home-holidays">
        {holidays.map((h) => {
          const key = String(h.calendarDate || h.date || '').slice(0, 10);
          const [y, m, d] = key.split('-').map(Number);
          const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
          return (
            <li key={h._id || key}>
              <span className="home-date"><b>{d}</b><small>{dt.toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short' })}</small></span>
              <div><b>{h.name}</b><small>{dt.toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long' })}{h.location && h.location !== 'ALL' ? ` · ${h.location === 'OFFICE' ? 'Office' : 'Factory'} only` : ''}</small></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
