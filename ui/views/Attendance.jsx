import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from '../lib/router.jsx';
import '../styles/attendance.css';
import Icon from '../components/Icon.jsx';
import { post } from '../api/client.js';
import { punchNow } from '../utils/punch.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility, canSeeWfh } from '../utils/permissions.js';
import { currentMonthKey, shiftMonth, monthLabel, formatTime, durationLabel, initialsOf, todayKey } from '../utils/time.js';
import PunchCard from './attendance/PunchCard.jsx';
import MonthCalendar from './attendance/MonthCalendar.jsx';
import DayDrawer from './attendance/DayDrawer.jsx';
import TeamBoard from './attendance/TeamBoard.jsx';
import Insights from './attendance/Insights.jsx';
import { statusMeta, downloadCsv } from './attendance/meta.js';

function EmployeePicker({ employees, value, onChange, selfId }) {
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
      <button type="button" className="att-picker-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="att-avatar">{initialsOf(current ? name(current) : '?')}</span>
        <div><b>{current ? name(current) : 'Choose a person'}{current?._id === selfId ? ' (you)' : ''}</b><small>{current ? `${current.employeeCode} · ${current.department || current.workLocation || ''}` : `${employees.length} people`}</small></div>
        <Icon name="ChevronDown" size={16} />
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

function Kpis({ summary }) {
  if (!summary) return <div className="att-kpis">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="att-skeleton" style={{ minHeight: 104 }} />)}</div>;
  const items = [
    ['present', 'UserRoundCheck', summary.present, 'Present days', `${summary.wfh ? `${summary.wfh} WFH · ` : ''}${summary.halfDays} half day${summary.halfDays === 1 ? '' : 's'}`],
    ['absent', 'UserX', summary.absent, 'Absent', summary.missingPunches ? `${summary.missingPunches} missing punch` : 'without leave'],
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
    if (['team', 'insights', 'calendar'].includes(h)) setTab(h);
  }, [routeLocation.hash]);

  const calendarPath = calendarEmployeeId ? `/attendance/calendar?month=${month}&employeeId=${calendarEmployeeId}` : '';
  const { data: calendar, error: calendarError, loading: calendarLoading, reload: reloadCalendar } = useApi(calendarPath, [calendarPath], { skeleton: false });
  const { data: mobileState, error: mobileError, reload: reloadMobile } = useApi(employee?._id ? '/attendance/mobile-state' : '', [employee?._id], { skeleton: false });
  const viewingSelfNow = calendarEmployeeId === employee?._id && month === currentMonthKey();
  const selfPath = employee?._id && !viewingSelfNow ? `/attendance/calendar?month=${currentMonthKey()}&employeeId=${employee._id}` : '';
  const { data: selfCalendar } = useApi(selfPath, [selfPath], { skeleton: false });
  const selfSummary = viewingSelfNow ? calendar?.summary : selfCalendar?.summary;

  // Keep the punch card fresh while the tab is open.
  useEffect(() => {
    if (!employee?._id) return undefined;
    const t = setInterval(() => reloadMobile().catch(() => {}), 120000);
    return () => clearInterval(t);
  }, [employee?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewed = calendar?.employee || employees.find((e) => e._id === calendarEmployeeId);
  const isSelf = calendarEmployeeId && employee?._id && String(calendarEmployeeId) === String(employee._id);
  const issues = (calendar?.days || []).filter((d) => ['ABSENT', 'HALF_DAY'].includes(d.status) || d.missingPunch || d.lopDays > 0).filter((d) => !d.isFuture).length;

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
    const day = (calendar?.days || []).find((d) => d.isToday) || (calendar?.days || []).filter((d) => !d.isFuture).slice(-1)[0];
    if (day) setSelectedDay(day);
  }

  async function recalculate() {
    try { await post('/attendance/evaluate-month', { month }, { loadingMessage: `Recalculating ${monthLabel(month)}…`, successMessage: 'Month recalculated with the latest rules' }); await reloadCalendar(); } catch (_) { /* toast shown */ }
  }

  async function importLogs() {
    try { await post('/attendance/import-biometric', { logs: JSON.parse(biometric) }, { loadingMessage: 'Importing punches…' }); await reloadCalendar(); } catch (err) { setNotice({ tone: 'bad', text: err.message }); }
  }

  function exportMonth() {
    const days = calendar?.days || [];
    downloadCsv(`attendance-${viewed?.employeeCode || 'employee'}-${month}.csv`, ['Date', 'Day', 'Status', 'Check in', 'Check out', 'Worked', 'Late (min)', 'Early (min)', 'LOP', 'Shift', 'Remarks'],
      days.filter((d) => !d.isFuture).map((d) => [d.date, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekday], statusMeta(d.status).label, d.checkIn ? formatTime(d.checkIn) : '', d.checkOut ? formatTime(d.checkOut) : '', d.workedMinutes ? durationLabel(d.workedMinutes) : '', d.lateMinutes || '', d.earlyLeaveMinutes || '', d.lopDays || '', d.shiftName, d.holidayName || d.deductionReason || '']));
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

      <Kpis summary={calendar?.summary} />

      <section className="att-panel">
        <div className="att-panel-head">
          <div className="att-tabs" role="tablist">
            <button type="button" role="tab" className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}><Icon name="CalendarDays" size={15} /> {isSelf ? 'My calendar' : 'Calendar'}{issues ? <em>{issues}</em> : null}</button>
            {canSeeOthers && <button type="button" role="tab" className={tab === 'team' ? 'active' : ''} onClick={() => setTab('team')}><Icon name="Users" size={15} /> Team today</button>}
            <button type="button" role="tab" className={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}><Icon name="Sparkles" size={15} /> Insights</button>
          </div>
          <div className="att-toolbar">
            {canSeeOthers && <div className="att-seg">{['ALL', 'OFFICE', 'FACTORY'].map((p) => <button type="button" key={p} className={place === p ? 'active' : ''} onClick={() => setPlace(p)}>{p === 'ALL' ? 'All' : p === 'OFFICE' ? 'Office' : 'Factory'}</button>)}</div>}
            {tab !== 'team' && <>
              {canSeeOthers && <EmployeePicker employees={scoped} value={calendarEmployeeId} onChange={(id) => { setCalendarEmployeeId(id); setSelectedDay(null); }} selfId={employee?._id} />}
              <div className="att-month-nav">
                <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month"><Icon name="ChevronLeft" size={16} /></button>
                <strong>{monthLabel(month)}</strong>
                <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= currentMonthKey()} aria-label="Next month"><Icon name="ChevronRight" size={16} /></button>
              </div>
              {month !== currentMonthKey() && <button type="button" className="att-today-btn" onClick={() => setMonth(currentMonthKey())}>This month</button>}
              <button type="button" className="att-icon-btn" onClick={exportMonth} disabled={!calendar?.days?.length}><Icon name="Download" size={14} /> CSV</button>
              {canEvaluate && <button type="button" className="att-icon-btn" onClick={recalculate} title="Re-apply attendance rules to every day of this month"><Icon name="RefreshCw" size={14} /> Recalculate</button>}
            </>}
          </div>
        </div>

        {calendarError && tab !== 'team' && <div className="att-alert" style={{ margin: 16 }}><Icon name="TriangleAlert" size={16} /><div>{calendarError.message}</div></div>}

        {tab === 'calendar' && <MonthCalendar days={calendar?.days || []} loading={calendarLoading} onOpen={setSelectedDay} showWfh={showWfh} />}
        {tab === 'team' && canSeeOthers && <TeamBoard location={place} canMessage={canMessage} onOpenPerson={(id) => { setCalendarEmployeeId(id); setMonth(currentMonthKey()); setTab('calendar'); }} />}
        {tab === 'insights' && <Insights calendar={calendar} month={month} employeeId={calendarEmployeeId} />}
      </section>

      {selectedDay && (
        <DayDrawer
          key={`${calendarEmployeeId}-${selectedDay.date}`}
          day={selectedDay}
          employee={viewed}
          isSelf={Boolean(isSelf)}
          canOverride={canOverride}
          canRequestForOthers={canRequestForOthers}
          showWfh={showWfh}
          onClose={() => setSelectedDay(null)}
          onSaved={() => { reloadCalendar(); reloadMobile().catch(() => {}); }}
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
