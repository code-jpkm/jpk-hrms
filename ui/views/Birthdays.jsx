import React, { useState } from 'react';
import '../styles/v26.css';
import Icon from '../components/Icon.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { AiButton } from '../components/AiKit.jsx';
import { formatDayKey, initialsOf } from '../utils/time.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function whenLabel(p) {
  if (p.daysAway === 0) return 'Today';
  if (p.daysAway === 1) return 'Tomorrow';
  if (p.daysAway < 7) return `In ${p.daysAway} days`;
  return formatDayKey(p.date, { day: 'numeric', month: 'short' });
}

function PersonCard({ p, kind }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [email, setEmail] = useState(true);
  const [whatsapp, setWhatsapp] = useState(true);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const isAnniv = kind === 'ANNIVERSARY';
  async function send() {
    setBusy(true);
    try {
      const r = await post('/messages/wish', { kind, employeeId: p.id, message: text, email, whatsapp }, { loadingMessage: `Sending wishes to ${p.firstName}…` });
      setDone(r.message); setOpen(false);
    } catch (_) { /* toast */ } finally { setBusy(false); }
  }
  return (
    <article className={`v26-person ${isAnniv ? 'anniv' : ''} ${p.isToday ? 'today' : ''}`}>
      <div className="v26-person-top">
        <span className="v26-avatar">{initialsOf(p.name)}</span>
        <div><b>{p.name}{p.isSelf ? ' (you)' : ''}</b><small>{[p.designation, p.department].filter(Boolean).join(' · ') || p.employeeCode}</small></div>
      </div>
      <div className="v26-when">
        <span>{isAnniv ? `${p.years} year${p.years === 1 ? '' : 's'} at JPK` : 'Birthday'} · {formatDayKey(p.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        <em>{whenLabel(p)}</em>
      </div>
      {done ? <div className="v26-note good" style={{ padding: '8px 10px' }}><Icon name="CircleCheck" size={14} /><div>{done}</div></div>
        : p.isSelf ? null
          : !open ? (
            <div className="v26-actions"><button type="button" className="v26-btn secondary" onClick={() => setOpen(true)} style={{ height: 36 }}><Icon name={isAnniv ? 'Award' : 'Gift'} size={15} /> Send wishes</button></div>
          ) : (
            <div className="v26-wish-box">
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Write a note for ${p.firstName}, or let Gemini write one`} />
              <div className="v26-actions">
                <AiButton small endpoint="/ai/messages/compose" body={{ purpose: kind, employeeId: p.id, channel: 'WHATSAPP' }} label="Write with Gemini" onResult={(r) => setText(r.text)} />
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 700 }}><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} style={{ width: 15, height: 15 }} /> Email</label>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 700 }}><input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} style={{ width: 15, height: 15 }} /> WhatsApp</label>
              </div>
              <div className="v26-actions">
                <button type="button" className="v26-btn" style={{ height: 38 }} onClick={send} disabled={busy}><Icon name="SendHorizontal" size={15} /> {busy ? 'Sending…' : 'Send'}</button>
                <button type="button" className="v26-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
              </div>
              <small style={{ color: 'var(--muted)', fontSize: 11.5 }}>Leave it empty and a warm message is written for you. {p.firstName} also gets an in-app notification.</small>
            </div>
          )}
    </article>
  );
}

export default function Birthdays() {
  const [mode, setMode] = useState('UPCOMING');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const path = mode === 'UPCOMING' ? '/employees/birthdays?upcoming=45' : `/employees/birthdays?month=${month}`;
  const { data, loading, error } = useApi(path, [path]);
  const birthdays = data?.birthdays || [];
  const anniversaries = data?.anniversaries || [];
  const todayCount = birthdays.filter((b) => b.isToday).length + anniversaries.filter((a) => a.isToday).length;

  return (
    <div className="v26-page">
      <section className="v26-hero page-intro">
        <div>
          <span className="v26-kicker"><Icon name="PartyPopper" size={14} /> People moments</span>
          <h1>Celebrations</h1>
          <p>{todayCount ? `${todayCount} celebration${todayCount === 1 ? '' : 's'} today! ` : ''}Birthdays and work anniversaries across JPK. Send a wish by email and WhatsApp in one click — Gemini can write it for you.</p>
        </div>
        <div className="v26-actions">
          <div className="v26-tabs">
            <button type="button" className={mode === 'UPCOMING' ? 'active' : ''} onClick={() => setMode('UPCOMING')}><Icon name="CalendarRange" size={14} /> Next 45 days</button>
            <button type="button" className={mode === 'MONTH' ? 'active' : ''} onClick={() => setMode('MONTH')}><Icon name="CalendarDays" size={14} /> By month</button>
          </div>
          {mode === 'MONTH' && <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={{ height: 40, borderRadius: 12, border: '1px solid #E1E1E4', padding: '0 10px', width: 'auto' }}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>}
        </div>
      </section>
      {error && <div className="v26-note bad"><Icon name="TriangleAlert" size={16} /><div>{error.message}</div></div>}

      <section className="v26-card">
        <div className="v26-card-head"><div><h2><Icon name="Cake" size={16} /> Birthdays</h2><small>{birthdays.length} {mode === 'UPCOMING' ? 'coming up' : `in ${MONTHS[month - 1]}`}</small></div></div>
        <div className="v26-card-body">
          {loading && !data ? <div className="att-skeleton" style={{ minHeight: 160 }} /> : birthdays.length ? <div className="v26-celebrate">{birthdays.map((p) => <PersonCard key={`b${p.id}`} p={p} kind="BIRTHDAY" />)}</div> : <div className="v26-empty">No birthdays in this period. Add dates of birth on employee profiles to see them here.</div>}
        </div>
      </section>

      <section className="v26-card">
        <div className="v26-card-head"><div><h2><Icon name="Award" size={16} /> Work anniversaries</h2><small>{anniversaries.length} {mode === 'UPCOMING' ? 'coming up' : `in ${MONTHS[month - 1]}`}</small></div></div>
        <div className="v26-card-body">
          {loading && !data ? <div className="att-skeleton" style={{ minHeight: 160 }} /> : anniversaries.length ? <div className="v26-celebrate">{anniversaries.map((p) => <PersonCard key={`a${p.id}`} p={p} kind="ANNIVERSARY" />)}</div> : <div className="v26-empty">No work anniversaries in this period.</div>}
        </div>
      </section>
    </div>
  );
}
