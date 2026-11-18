import React, { useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { ErrorBox } from '../components/Ui.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';
import { GeminiBadge } from '../components/AiKit.jsx';
import { formatDate, initialsOf, todayKey } from '../utils/time.js';
import '../styles/attendance.css';
import '../styles/v26.css';

const FILTERS = [
  { key: 'PENDING_MANAGER', label: 'Awaiting decision', icon: 'Hourglass' },
  { key: 'CONFIRMED', label: 'Confirmed', icon: 'BadgeCheck' },
  { key: 'EXTENDED', label: 'Extended', icon: 'CalendarClock' },
  { key: 'ALL', label: 'All reviews', icon: 'ListChecks' }
];

const STATUS_LABEL = { PENDING_MANAGER: 'Awaiting decision', CONFIRMED: 'Confirmed', EXTENDED: 'Extended', CLOSED: 'Closed' };

function nameOf(emp) {
  return `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim() || 'Employee';
}

/** Whole days from today (IST) to a stored date; negative when overdue. */
function daysUntil(value) {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  const dueKey = due.toISOString().slice(0, 10);
  const [y, m, d] = todayKey().split('-').map(Number);
  const [yy, mm, dd] = dueKey.split('-').map(Number);
  return Math.round((Date.UTC(yy, mm - 1, dd) - Date.UTC(y, m - 1, d)) / 86400000);
}

function dueTone(days, status) {
  if (status !== 'PENDING_MANAGER') return 'off';
  if (days === null) return 'off';
  if (days < 0) return 'bad';
  if (days <= 7) return 'warn';
  return 'on';
}

function dueText(days, status) {
  if (status !== 'PENDING_MANAGER' || days === null) return null;
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

export default function Probation() {
  const { user } = useAuth();
  const canManageProbation = hasAbility(user, 'PROBATION', 'MANAGE');
  const { data, error, loading, reload } = useApi('/probation', []);
  const [filter, setFilter] = useState('PENDING_MANAGER');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(null);
  const [runError, setRunError] = useState(null);
  const [running, setRunning] = useState(false);

  const reviews = data?.reviews || [];
  const stats = useMemo(() => {
    const pending = reviews.filter((r) => r.status === 'PENDING_MANAGER');
    return {
      pending: pending.length,
      overdue: pending.filter((r) => (daysUntil(r.dueDate) ?? 1) < 0).length,
      week: pending.filter((r) => { const d = daysUntil(r.dueDate); return d !== null && d >= 0 && d <= 7; }).length,
      confirmed: reviews.filter((r) => r.status === 'CONFIRMED').length,
      extended: reviews.filter((r) => r.status === 'EXTENDED').length
    };
  }, [reviews]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reviews
      .filter((r) => filter === 'ALL' || r.status === filter)
      .filter((r) => !q || `${nameOf(r.employeeId)} ${r.employeeId?.employeeCode || ''} ${r.employeeId?.department || ''}`.toLowerCase().includes(q));
  }, [reviews, filter, query]);

  async function runReminders() {
    setRunError(null); setRunning(true);
    try {
      await post('/probation/run-reminders', {}, { loadingMessage: 'Checking probation due dates…', successMessage: 'Reminders sent to managers and HR' });
      reload();
    } catch (err) { setRunError(err); } finally { setRunning(false); }
  }

  return (
    <div className="nexus-page v26-page" style={{ display: 'grid', gap: 16 }}>
      <section className="v26-hero page-intro">
        <div>
          <span className="v26-kicker"><Icon name="UserCheck" size={14} /> Employee lifecycle</span>
          <h1>Probation reviews</h1>
          <p>Every probation that ends within a week is flagged automatically. Managers and HR get an email, WhatsApp and in-app reminder; the employee is told by email and WhatsApp once you confirm or extend.</p>
        </div>
        {canManageProbation && (
          <button type="button" className="v26-btn" onClick={runReminders} disabled={running}>
            <Icon name="BellRing" size={16} /> {running ? 'Checking…' : 'Send reminders now'}
          </button>
        )}
      </section>

      <ErrorBox error={error || runError} />

      <div className="v26-stats" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="v26-stat"><b>{stats.pending}</b><span>Awaiting decision</span></div>
        <div className="v26-stat" style={stats.overdue ? { background: '#F7F7F8', borderColor: '#E1E1E4' } : undefined}><b style={stats.overdue ? { color: '#B85C10' } : undefined}>{stats.overdue}</b><span>Overdue</span></div>
        <div className="v26-stat"><b>{stats.week}</b><span>Due within 7 days</span></div>
        <div className="v26-stat"><b>{stats.confirmed}<small style={{ fontSize: 13, color: '#807F84', fontWeight: 700 }}> / {stats.extended} ext.</small></b><span>Confirmed / extended</span></div>
      </div>

      <section className="v26-card">
        <div className="v26-card-head">
          <div className="v26-chiprow">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={`v26-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
                <Icon name={f.icon} size={14} /> {f.label}
                {f.key === 'PENDING_MANAGER' && stats.pending > 0 && <span className="v26-pill" style={{ height: 18, marginLeft: 2 }}>{stats.pending}</span>}
              </button>
            ))}
          </div>
          <div className="v26-filters" style={{ margin: 0 }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, code or department" aria-label="Search reviews" />
          </div>
        </div>
        <div className="v26-card-body" style={{ display: 'grid', gap: 10 }}>
          {loading && !data && <div className="ai-shimmer"><span style={{ width: '92%' }} /><span style={{ width: '76%' }} /><span style={{ width: '84%' }} /></div>}
          {!loading && !visible.length && (
            <div className="v26-empty">
              <Icon name="PartyPopper" size={22} />
              <div style={{ marginTop: 6 }}>{filter === 'PENDING_MANAGER' ? 'No probation reviews are waiting on you.' : 'Nothing to show for this filter.'}</div>
            </div>
          )}
          {visible.map((r) => <ReviewRow key={r._id} review={r} onOpen={() => setActive(r)} />)}
        </div>
      </section>

      {active && <DecisionPanel review={active} onClose={() => setActive(null)} onDone={() => { setActive(null); reload(); }} />}
    </div>
  );
}

function ReviewRow({ review: r, onOpen }) {
  const emp = r.employeeId || {};
  const days = daysUntil(r.dueDate);
  const pending = r.status === 'PENDING_MANAGER';
  return (
    <div className="v26-person" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', padding: '14px 16px' }}>
      <div className="v26-person-top" style={{ minWidth: 0 }}>
        <span className="v26-avatar" style={{ background: 'linear-gradient(135deg,#1F3445,#1F3445)' }}>{initialsOf(nameOf(emp))}</span>
        <div style={{ minWidth: 0 }}>
          <b>{nameOf(emp)} <small style={{ color: '#807F84', fontWeight: 700 }}>{emp.employeeCode}</small></b>
          <small style={{ display: 'block', color: '#6A6A6F', fontWeight: 600 }}>{[emp.designation, emp.department].filter(Boolean).join(' · ') || 'Role not set'}</small>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <span className="v26-pill"><Icon name="CalendarDays" size={12} /> Ends {formatDate(r.dueDate)}</span>
            {r.managerEmployeeId && <span className="v26-pill"><Icon name="UserRound" size={12} /> {nameOf(r.managerEmployeeId)}</span>}
            {r.remindersSent > 0 && pending && <span className="v26-pill"><Icon name="BellRing" size={12} /> {r.remindersSent} reminder{r.remindersSent === 1 ? '' : 's'}</span>}
            {r.status === 'EXTENDED' && r.extendedUntil && <span className="v26-pill">Extended to {formatDate(r.extendedUntil)}</span>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {pending ? <span className={`v26-dot ${dueTone(days, r.status)}`}>{dueText(days, r.status)}</span> : <span className={`v26-dot ${r.status === 'CONFIRMED' ? 'on' : 'warn'}`}>{STATUS_LABEL[r.status] || r.status}</span>}
        <button type="button" className={pending ? 'v26-btn' : 'v26-btn secondary'} style={{ height: 38 }} onClick={onOpen}>
          {pending ? <><Icon name="ClipboardCheck" size={15} /> Review</> : <><Icon name="Eye" size={15} /> Details</>}
        </button>
      </div>
    </div>
  );
}

function DecisionPanel({ review, onClose, onDone }) {
  const emp = review.employeeId || {};
  const pending = review.status === 'PENDING_MANAGER';
  const [notes, setNotes] = useState('');
  const [remarks, setRemarks] = useState(review.managerRemarks || '');
  const [months, setMonths] = useState(1);
  const [ai, setAi] = useState({ loading: false, result: null, error: '' });
  const [saving, setSaving] = useState('');
  const [error, setError] = useState(null);

  async function draft() {
    setAi({ loading: true, result: null, error: '' });
    try {
      const result = await post(`/ai/probation/${emp._id}/review`, { notes }, { toast: false });
      setAi({ loading: false, result, error: '' });
      if (!remarks.trim() && result?.data?.remarksDraft) setRemarks(result.data.remarksDraft);
    } catch (err) { setAi({ loading: false, result: null, error: err.message }); }
  }

  async function decide(action) {
    setError(null); setSaving(action);
    try {
      await post(`/probation/${review._id}/decision`, { action, extensionMonths: months, remarks }, {
        loadingMessage: action === 'CONFIRM' ? 'Confirming employment…' : 'Extending probation…',
        successMessage: action === 'CONFIRM' ? `${nameOf(emp)} confirmed. They will be notified.` : `Probation extended by ${months} month${months === 1 ? '' : 's'}.`
      });
      onDone();
    } catch (err) { setError(err); } finally { setSaving(''); }
  }

  const d = ai.result?.data || {};
  const f = d.facts || null;
  const recTone = /confirm/i.test(d.recommendation || '') ? 'on' : /extend/i.test(d.recommendation || '') ? 'warn' : 'off';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="letter-modal wide v26-page" onClick={(e) => e.stopPropagation()} style={{ display: 'grid', gap: 14, maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div className="v26-person-top">
            <span className="v26-avatar" style={{ background: 'linear-gradient(135deg,#1F3445,#1F3445)' }}>{initialsOf(nameOf(emp))}</span>
            <div>
              <small style={{ fontWeight: 800, letterSpacing: '.1em', color: '#807F84' }}>PROBATION REVIEW</small>
              <h3 style={{ margin: '2px 0 0' }}>{nameOf(emp)} <small style={{ color: '#807F84' }}>{emp.employeeCode}</small></h3>
              <small style={{ color: '#6A6A6F' }}>{[emp.designation, emp.department].filter(Boolean).join(' · ')} · probation ends {formatDate(review.dueDate)}</small>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <ErrorBox error={error} />

        {!pending && (
          <div className={`v26-note ${review.status === 'CONFIRMED' ? 'good' : 'warn'}`}>
            <Icon name={review.status === 'CONFIRMED' ? 'BadgeCheck' : 'CalendarClock'} size={16} />
            <div>
              <b>{STATUS_LABEL[review.status]}</b>{review.decidedAt ? ` on ${formatDate(review.decidedAt)}` : ''}
              {review.status === 'EXTENDED' && review.extendedUntil ? ` · new review date ${formatDate(review.extendedUntil)}` : ''}
              {review.managerRemarks && <div style={{ marginTop: 4 }}>“{review.managerRemarks}”</div>}
            </div>
          </div>
        )}

        {pending && (
          <>
            <div className="leave-ai-box" style={{ display: 'grid', gap: 10 }}>
              <div className="leave-ai-head" style={{ justifyContent: 'space-between' }}>
                <b style={{ fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="Sparkles" size={15} /> Draft the review with Gemini</b>
                {ai.result && <GeminiBadge used={ai.result.usedAi} model={ai.result.model} compact />}
              </div>
              <label className="v26-field" style={{ margin: 0 }}>Your observations (work quality, ownership, teamwork — Gemini weighs these most)
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1500} placeholder="e.g. Learns machines quickly, owns the night-shift handover, needs to improve report accuracy" style={{ minHeight: 76, borderRadius: 12, border: '1px solid #E1E1E4', padding: 10 }} />
              </label>
              <div className="v26-actions">
                <button type="button" className="ai-inline-btn" onClick={draft} disabled={ai.loading}><Icon name="Sparkles" size={14} /> {ai.loading ? 'Drafting…' : ai.result ? 'Draft again' : 'Draft review'}</button>
                <small style={{ color: '#807F84' }}>Uses attendance, leave and your notes. You stay in control of the decision.</small>
              </div>
              {ai.error && <p className="ai-error"><Icon name="TriangleAlert" size={13} /> {ai.error}</p>}
              {ai.loading && <div className="ai-shimmer"><span style={{ width: '88%' }} /><span style={{ width: '70%' }} /><span style={{ width: '80%' }} /></div>}
              {ai.result && (
                <div style={{ display: 'grid', gap: 10 }}>
                  {f && (
                    <div className="v26-stats" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
                      <div className="v26-stat"><b>{f.workingDaysRecorded}</b><span>Working days</span></div>
                      <div className="v26-stat"><b>{f.presentDays}</b><span>Present</span></div>
                      <div className="v26-stat"><b>{f.absentDays}</b><span>Absent</span></div>
                      <div className="v26-stat"><b>{f.lateDays}</b><span>Late days</span></div>
                      <div className="v26-stat"><b>{f.approvedLeaveDays}</b><span>Leave taken</span></div>
                    </div>
                  )}
                  {d.recommendation && <div><span className={`v26-dot ${recTone}`}>Suggested: {d.recommendation}</span></div>}
                  {d.summary && <p className="ai-summary" style={{ fontSize: 13.5, margin: 0 }}>{d.summary}</p>}
                  <div className="ai-cols">
                    <div><h5>Strengths</h5><ul className="ai-bullets good">{(d.strengths || []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                    <div><h5>To improve</h5><ul className="ai-bullets bad">{(d.improvements || []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                  </div>
                  {d.remarksDraft && (
                    <div className="v26-actions">
                      <button type="button" className="v26-btn ghost" onClick={() => setRemarks(d.remarksDraft)}><Icon name="ClipboardPaste" size={14} /> Use the drafted remarks</button>
                    </div>
                  )}
                  {d.note && <small style={{ color: '#807F84' }}>{d.note}</small>}
                </div>
              )}
            </div>

            <label className="v26-field" style={{ margin: 0 }}>Decision remarks (shared with the employee)
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} placeholder="A short note the employee will see with the outcome" style={{ minHeight: 70, borderRadius: 12, border: '1px solid #E1E1E4', padding: 10 }} />
            </label>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <label className="v26-field" style={{ margin: 0, minWidth: 180 }}>If extending, by
                <select value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ height: 40, borderRadius: 11, border: '1px solid #E1E1E4', padding: '0 10px' }}>
                  {[1, 2, 3, 4, 5, 6].map((m) => <option key={m} value={m}>{m} month{m === 1 ? '' : 's'}</option>)}
                </select>
              </label>
              <div className="v26-actions">
                <button type="button" className="v26-btn secondary" onClick={() => decide('EXTEND')} disabled={Boolean(saving)}><Icon name="CalendarClock" size={15} /> {saving === 'EXTEND' ? 'Extending…' : 'Extend probation'}</button>
                <button type="button" className="v26-btn" onClick={() => decide('CONFIRM')} disabled={Boolean(saving)}><Icon name="BadgeCheck" size={15} /> {saving === 'CONFIRM' ? 'Confirming…' : 'Confirm employment'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
