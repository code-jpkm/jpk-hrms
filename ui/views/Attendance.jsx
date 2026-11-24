import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from '../lib/router.jsx';
import '../styles/attendance.css';
import Icon from '../components/Icon.jsx';
import { post } from '../api/client.js';
import { punchNow } from '../utils/punch.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility, canSeeWfh } from '../utils/permissions.js';
import { currentMonthKey, shiftMonth, monthLabel, formatTime, formatPunch, durationLabel, initialsOf, todayKey } from '../utils/time.js';
import PunchCard from './attendance/PunchCard.jsx';
import MonthCalendar from './attendance/MonthCalendar.jsx';
import DayDrawer from './attendance/DayDrawer.jsx';
import TeamBoard from './attendance/TeamBoard.jsx';
import Insights from './attendance/Insights.jsx';
import Reports from './attendance/Reports.jsx';
import { statusMeta, downloadCsv } from './attendance/meta.js';

const isSameId = (a, b) => Boolean(a && b) && String(a) === String(b);

function EmployeePicker({ employees, value, onChange, selfId, loading = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const current = employees.find((e) => e._id === value);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const list = employees.filter((e) => `${e.firstName} ${e.lastName || ''} ${e.employeeCode} ${e.department || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const name = (e) => `${e.firstName} ${e.lastName || ''}`.trim();
  return (
    <div className="att-picker" ref={ref}>
      <button type="button" className={`att-picker-btn${loading ? ' is-loading' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} aria-busy={loading}>
        <span className="att-avatar">{initialsOf(current ? name(current) : '?')}</span>
        <div><b>{current ? name(current) : 'Choose a person'}{current?._id === selfId ? ' (you)' : ''}</b><small>{loading ? 'Loading…' : current ? `${current.employeeCode} · ${current.department || current.workLocation || ''}` : `${employees.length} people`}</small></div>
        {loading ? <Icon name="Loader2" size={16} className="att-spin" /> : <Icon name="ChevronDown" size={16} />}
      </button>
      {open && (
        <div className="att-picker-menu" role="listbox">
          <input autoFocus placeholder="Search by name, code or department" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="att-picker-list">
            {list.slice(0, 200).map((e) => (
              <button type="button" key={e._id} className={e._id === value ? 'active' : ''} onClick={() => { onChange(e._id); setOpen(false); setQ(''); }}>
                <span className="att-avatar">{initialsOf(name(e))}</span>
                <span><b>{name(e)}{e._id === selfId ? ' (you)' : ''}</b><small>{e.employeeCode} · {e.department || '—'} · {e.workLocation || ''}</small></span>
              </button>
            ))}
            {!list.length && <div className="att-empty" style={{ padding: 14 }}>No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Says whose month is on screen. While another person or month is loading it
 * says so (and the numbers below are hidden), so the old person's numbers are
 * never read as the new person's.
 */
function ViewingBar({ person, month, state, loadedAt, isSelf }) {
  const name = person ? (`${person.firstName || ''} ${person.lastName || ''}`.trim() || person.employeeCode || 'this person') : 'this person';
  const sub = [person?.employeeCode, person?.department || person?.workLocation].filter(Boolean).join(' · ');
  const whose = isSelf ? 'your' : `${person?.firstName || name}'s`;
  return (
    <div className={`att-viewing ${state}`} role="status" aria-live="polite" aria-busy={state === 'loading' || state === 'refreshing'}>
      <span className="att-avatar">{initialsOf(name)}</span>
      <div className="att-viewing-who">
        <b>{name}{isSelf ? ' (you)' : ''}</b>
        <small>{sub ? `${sub} · ` : ''}{monthLabel(month)}</small>
      </div>
      <div className="att-viewing-state">
        {state === 'loading' && <><Icon name="Loader2" size={15} className="att-spin" /> Loading {whose} {monthLabel(month)}…</>}
        {state === 'refreshing' && <><Icon name="Loader2" size={15} className="att-spin" /> Updating…</>}
        {state === 'ready' && <><Icon name="CircleCheck" size={15} /> Showing {monthLabel(month)}{loadedAt ? ` · loaded at ${formatPunch(loadedAt)}` : ''}</>}
        {state === 'error' && <><Icon name="TriangleAlert" size={15} /> Could not load this month</>}
      </div>
      {state === 'loading' && <i className="att-viewing-bar" aria-hidden="true" />}
    </div>
  );
}

function Kpis({ summary, failed = false }) {
  if (!summary && failed) return null;
  if (!summary) return <div className="att-kpis">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="att-skeleton" style={{ minHeight: 104 }} />)}</div>;
  const items = [
    ['present', 'UserRoundCheck', summary.present, 'Present days', summary.needsReview ? `${summary.needsReview} out time missing · needs a decision` : `${summary.wfh ? `${summary.wfh} WFH · ` : ''}${summary.halfDays} half day${summary.halfDays === 1 ? '' : 's'}`],
    ['absent', 'UserX', summary.absent, 'Absent', 'without leave'],
    ['leave', 'Palmtree', summary.leaveDays, 'Leave days', `${summary.holidays} holiday${summary.holidays === 1 ? '' : 's'} this month`],
    ['late', 'AlarmClock', summary.lateDays, 'Late arrivals', summary.lateMinutes ? `${summary.lateMinutes} min in total` : 'none so far'],
    ['early', 'LogOut', summary.earlyLeaveDays, 'Early exits', 'before shift end'],
    ['lop', 'TriangleAlert', summary.lopDays, 'LOP days', 'loss of pay so far'],
    ['time', 'Clock3', summary.avgCheckIn ? formatTime(`2000-01-01T${summary.avgCheckIn}:00+05:30`) : '—', 'Avg check-in', summary.avgWorkedMinutes ? `${durationLabel(summary.avgWorkedMinutes)} avg day` : 'no punches yet'],
    ['rate', 'Activity', summary.attendanceRate !== null && summary.attendanceRate !== undefined ? `${summary.attendanceRate}%` : '—', 'Attendance rate', summary.onTimeRate !== null && summary.onTimeRate !== undefined ? `${summary.onTimeRate}% on time` : `${summary.elapsedWorkingDays} working days`]
  ];
  return (
    <div className="att-kpis">
      {items.map(([cls, icon, value, label, hint]) => (
        <div key={cls} className={`att-kpi ${cls}`}><i><Icon name={icon} size={16} /></i><b>{value}</b><span>{label}</span><small>{hint}</small></div>
      ))}
    </div>
  );
}

export default function Attendance() {
  const { user, employee } = useAuth();
  const routeLocation = useLocation();
  const showWfh = canSeeWfh(user, employee);
  const canOverride = hasAbility(user, 'ATTENDANCE', 'OVERRIDE');
  const canImport = hasAbility(user, 'ATTENDANCE', 'IMPORT');
  const canEvaluate = hasAbility(user, 'ATTENDANCE', 'EVALUATE') || ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'].includes(user?.role);
  const canRequestForOthers = hasAbility(user, 'REGULARIZATION', 'APPLY_ON_BEHALF');
  const isManager = user?.role === 'MANAGER';
  // What the day drawer may offer. The server checks each action again
  // (scope, reporting line), so these only decide which buttons are shown.
  const dayPerms = {
    canOverride,
    canFixTimes: canOverride || canRequestForOthers || isManager,
    canManageShifts: hasAbility(user, 'SHIFTS', 'MANAGE'),
    canDecideLeave: hasAbility(user, 'LEAVE', 'APPROVE') || isManager,
    canAddLeave: canOverride || hasAbility(user, 'LEAVE', 'APPLY_ON_BEHALF') || isManager,
    canDecideRequests: hasAbility(user, 'REGULARIZATION', 'APPROVE') || isManager,
    canRequestForOthers,
    selfApproves: user?.role === 'SUPER_ADMIN'
  };
  const canMessage = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role) || hasAbility(user, 'NOTICES', 'MANAGE') || hasAbility(user, 'MESSAGES', 'SEND');

  const [month, setMonth] = useState(currentMonthKey());
  const [place, setPlace] = useState('ALL');
  const [tab, setTab] = useState('calendar');
  const [calendarEmployeeId, setCalendarEmployeeId] = useState(employee?._id || '');
  const [selectedDay, setSelectedDay] = useState(null);
  const [punching, setPunching] = useState(false);
  const [notice, setNotice] = useState(null);
  const [biometric, setBiometric] = useState('[]');

  const { data: employeesData } = useApi('/attendance/employees', []);
  const employees = employeesData?.employees || [];
  const scoped = useMemo(() => employees.filter((e) => place === 'ALL' || e.workLocation === place || e.workLocation === 'BOTH'), [employees, place]);
  const canSeeOthers = employees.some((e) => !employee || String(e._id) !== String(employee._id));

  useEffect(() => {
    if (!calendarEmployeeId && (employee?._id || scoped.length)) setCalendarEmployeeId(employee?._id && scoped.some((e) => e._id === employee._id) ? employee._id : scoped[0]?._id || '');
    else if (calendarEmployeeId && scoped.length && !scoped.some((e) => e._id === calendarEmployeeId)) setCalendarEmployeeId(scoped[0]._id);
  }, [calendarEmployeeId, scoped, employee?._id]);

  // Deep links: /attendance#team, /attendance#insights
  useEffect(() => {
    const h = routeLocation.hash.replace('#', '');
    if (['team', 'insights', 'calendar', 'reports'].includes(h)) setTab(h);
  }, [routeLocation.hash]);

  const calendarPath = calendarEmployeeId ? `/attendance/calendar?month=${month}&employeeId=${calendarEmployeeId}` : '';
  const { data: calendar, error: calendarError, loading: calendarLoading, reload: reloadCalendar } = useApi(calendarPath, [calendarPath], { skeleton: false });
  // Only the month that was picked is shown. While another person or month is
  // on its way, the previous one is hidden and the page says it is loading.
  const wantedKey = calendarEmployeeId ? `${calendarEmployeeId}|${month}` : '';
  const shown = calendar && wantedKey && `${calendar.employee?._id || ''}|${calendar.month || ''}` === wantedKey ? calendar : null;
  const viewState = !wantedKey ? 'idle' : calendarError && !calendarLoading ? 'error' : !shown ? 'loading' : calendarLoading ? 'refreshing' : 'ready';
  const [loadedAt, setLoadedAt] = useState(null);
  useEffect(() => { if (shown && !calendarLoading) setLoadedAt(new Date()); }, [shown, calendarLoading]);
  const { data: mobileState, error: mobileError, reload: reloadMobile } = useApi(employee?._id ? '/attendance/mobile-state' : '', [employee?._id], { skeleton: false });
  const viewingSelfNow = calendarEmployeeId === employee?._id && month === currentMonthKey();
  const selfPath = employee?._id && !viewingSelfNow ? `/attendance/calendar?month=${currentMonthKey()}&employeeId=${employee._id}` : '';
  const { data: selfCalendar } = useApi(selfPath, [selfPath], { skeleton: false });
  const selfSummary = viewingSelfNow ? shown?.summary : selfCalendar?.summary;

  // Keep the punch card fresh while the tab is open.
  useEffect(() => {
    if (!employee?._id) return undefined;
    const t = setInterval(() => reloadMobile().catch(() => {}), 120000);
    return () => clearInterval(t);
  }, [employee?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewed = shown?.employee || employees.find((e) => e._id === calendarEmployeeId) || (isSameId(calendarEmployeeId, employee?._id) ? employee : null);
  const isSelf = calendarEmployeeId && employee?._id && String(calendarEmployeeId) === String(employee._id);
  const whoseMonth = isSelf ? 'your' : viewed?.firstName ? `${viewed.firstName}'s` : 'their';
  const issues = (shown?.days || []).filter((d) => ['ABSENT', 'HALF_DAY', 'REVIEW'].includes(d.status) || d.missingPunch || d.lopDays > 0).filter((d) => !d.isFuture).length;

  async function punch(mode) {
    setPunching(true); setNotice(null);
    try {
      const res = await punchNow(mode);
      setNotice({ tone: 'good', text: res?.message || (mode === 'in' ? 'Checked in.' : 'Checked out.') });
      await Promise.all([reloadMobile(), reloadCalendar(), selfPath ? Promise.resolve() : Promise.resolve()]);
    } catch (err) {
      setNotice({ tone: 'bad', text: err.message });
    } finally {
      setPunching(false);
    }
  }

  function openTodayForCorrection() {
    if (!employee?._id) return;
    if (calendarEmployeeId !== employee._id || month !== currentMonthKey()) {
      setCalendarEmployeeId(employee._id);
      setMonth(currentMonthKey());
      setTab('calendar');
      setNotice({ tone: 'info', text: 'Pick the day you want to correct in your calendar below.' });
      return;
    }
    const day = (shown?.days || []).find((d) => d.isToday) || (shown?.days || []).filter((d) => !d.isFuture).slice(-1)[0];
    if (day) setSelectedDay(day);
  }

  async function recalculate() {
    try { await post('/attendance/evaluate-month', { month }, { loadingMessage: `Recalculating ${monthLabel(month)}…` }); await reloadCalendar(); } catch (_) { /* toast shown */ }
  }

  async function importLogs() {
    try { await post('/attendance/import-biometric', { logs: JSON.parse(biometric) }, { loadingMessage: 'Importing punches…' }); await reloadCalendar(); } catch (err) { setNotice({ tone: 'bad', text: err.message }); }
  }

  function exportMonth() {
    const days = shown?.days || [];
    downloadCsv(`attendance-${viewed?.employeeCode || 'employee'}-${month}.csv`, ['Date', 'Day', 'Status', 'Check in', 'Check out', 'Worked', 'Late (min)', 'Early (min)', 'LOP', 'Shift', 'Remarks'],
      days.filter((d) => !d.isFuture).map((d) => [d.date, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekday], statusMeta(d.status).label, d.checkIn ? formatPunch(d.checkIn) : '', d.checkOut ? formatPunch(d.checkOut) : '', d.workedMinutes ? durationLabel(d.workedMinutes) : '', d.lateMinutes || '', d.earlyLeaveMinutes || '', d.lopDays || '', d.shiftName, d.holidayName || d.deductionReason || '']));
  }

  const firstName = employee?.firstName || user?.name?.split(' ')[0];

  return (
    <div className="att-page">
      {employee?._id ? (
        <PunchCard firstName={firstName} state={mobileState} stateError={mobileError?.message} onPunch={punch} punching={punching} monthSummary={selfSummary} onRequestCorrection={openTodayForCorrection} />
      ) : (
        <section className="att-hero"><div><span className="att-hero-kicker"><Icon name="CalendarClock" size={14} /> Time &amp; attendance</span><h1>Attendance control room</h1><div className="att-hero-date">Your login is not linked to an employee profile, so there is no personal punch card. Team calendars are below.</div></div></section>
      )}

      {notice && <div className={`att-alert ${notice.tone === 'good' ? 'good' : notice.tone === 'info' ? 'info' : ''}`} role="status"><Icon name={notice.tone === 'good' ? 'CircleCheck' : notice.tone === 'info' ? 'Info' : 'TriangleAlert'} size={16} /><div>{notice.text}</div></div>}

      {wantedKey && <ViewingBar key={`${wantedKey}-${viewState === 'ready' ? 'ready' : 'wait'}`} person={viewed} month={month} state={viewState} loadedAt={loadedAt} isSelf={Boolean(isSelf)} />}

      <Kpis summary={shown?.summary} failed={viewState === 'error'} />

      <section className="att-panel">
        <div className="att-panel-head">
          <div className="att-tabs" role="tablist">
            <button type="button" role="tab" className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}><Icon name="CalendarDays" size={15} /> {isSelf ? 'My calendar' : 'Calendar'}{issues ? <em>{issues}</em> : null}</button>
            {canSeeOthers && <button type="button" role="tab" className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}><Icon name="Users" size={15} /> Team today</button>}
            <button type="button" role="tab" className={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}><Icon name="Sparkles" size={15} /> Insights</button>
            {canSeeOthers && <button type="button" role="tab" className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}><Icon name="FileSpreadsheet" size={15} /> Reports</button>}
          </div>
          <div className="att-toolbar">
            {canSeeOthers && <div className="att-seg">{['ALL', 'OFFICE', 'FACTORY'].map((p) => <button type="button" key={p} className={place === p ? 'active' : ''} onClick={() => setPlace(p)}>{p === 'ALL' ? 'All' : p === 'OFFICE' ? 'Office' : 'Factory'}</button>)}</div>}
            {tab !== 'team' && <>
              {canSeeOthers && tab !== 'reports' && <EmployeePicker employees={scoped} value={calendarEmployeeId} onChange={(id) => { setCalendarEmployeeId(id); setSelectedDay(null); }} selfId={employee?._id} loading={viewState === 'loading'} />}
              <div className="att-month-nav">
                <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month"><Icon name="ChevronLeft" size={16} /></button>
                <strong aria-busy={viewState === 'loading' && tab !== 'reports'}>{monthLabel(month)}{viewState === 'loading' && tab !== 'reports' && <Icon name="Loader2" size={13} className="att-spin" />}</strong>
                <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= currentMonthKey()} aria-label="Next month"><Icon name="ChevronRight" size={16} /></button>
              </div>
              {month !== currentMonthKey() && <button type="button" className="att-today-btn" onClick={() => setMonth(currentMonthKey())}>This month</button>}
              {tab !== 'reports' && <button type="button" className="att-icon-btn" onClick={exportMonth} disabled={!shown?.days?.length}><Icon name="Download" size={14} /> CSV</button>}
              {canEvaluate && <button type="button" className="att-icon-btn" onClick={recalculate} title="Re-apply attendance rules to every day of this month"><Icon name="RefreshCw" size={14} /> Recalculate</button>}
            </>}
          </div>
        </div>

        {calendarError && tab !== 'team' && tab !== 'reports' && <div className="att-alert" style={{ margin: 16 }}><Icon name="TriangleAlert" size={16} /><div>{calendarError.message}</div></div>}

        {tab === 'calendar' && <MonthCalendar key={shown ? wantedKey : 'loading'} days={shown?.days || []} loading={viewState === 'loading' || viewState === 'refreshing'} loadingLabel={`Loading ${whoseMonth} ${monthLabel(month)}…`} onOpen={setSelectedDay} showWfh={showWfh} />}
        {tab === 'team' && canSeeOthers && <TeamBoard location={place} canMessage={canMessage} onOpenPerson={(id) => { setCalendarEmployeeId(id); setMonth(currentMonthKey()); setTab('calendar'); }} />}
        {tab === 'insights' && <Insights calendar={shown} month={month} employeeId={calendarEmployeeId} />}
        {tab === 'reports' && canSeeOthers && <Reports month={month} place={place} />}
      </section>

      {selectedDay && (
        <DayDrawer
          key={`${calendarEmployeeId}-${selectedDay.date}`}
          day={selectedDay}
          employee={viewed}
          isSelf={Boolean(isSelf)}
          perms={isSelf ? { ...dayPerms, canFixTimes: canOverride, canDecideLeave: false, canDecideRequests: false } : dayPerms}
          payrollStatus={shown?.payroll?.status || null}
          showWfh={showWfh}
          onClose={() => setSelectedDay(null)}
          onSaved={(freshDay) => {
            // The drawer stays open on the same day and shows its new state.
            if (freshDay) setSelectedDay(freshDay);
            reloadCalendar().then((cal) => {
              if (!freshDay && cal?.days) {
                const again = cal.days.find((d) => d.date === selectedDay?.date);
                if (again) setSelectedDay(again);
              }
            }).catch(() => {});
            reloadMobile().catch(() => {});
          }}
        />
      )}

      {canImport && (
        <details className="att-admin">
          <summary><Icon name="Fingerprint" size={15} /> Admin tools · manual biometric import</summary>
          <div className="att-admin-body">
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--att-muted)' }}>For controlled troubleshooting only. The office and factory bridges push punches automatically every few minutes. Paste a JSON array such as <code>[{'{'}"employeeCode":"EMP001","timestamp":"{todayKey()}T09:55:00+05:30"{'}'}]</code>.</p>
            <textarea value={biometric} onChange={(e) => setBiometric(e.target.value)} spellCheck="false" />
            <div><button type="button" className="att-btn secondary" onClick={importLogs}><Icon name="Database" size={15} /> Import JSON punches</button></div>
          </div>
        </details>
      )}
    </div>
  );
}
