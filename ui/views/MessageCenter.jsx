import React, { useEffect, useMemo, useState } from 'react';
import '../styles/v26.css';
import Icon from '../components/Icon.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { AiButton, GeminiBadge } from '../components/AiKit.jsx';
import { formatDateTime, formatTime } from '../utils/time.js';

const AUDIENCES = [
  ['ALL', 'Users', 'Everyone'],
  ['OFFICE', 'Building2', 'Office'],
  ['FACTORY', 'Factory', 'Factory'],
  ['DEPARTMENT', 'Network', 'Departments'],
  ['SELECTED', 'UserCheck', 'Selected people']
];

const STARTERS = [
  ['Holiday announcement', 'Holiday notice', 'The office and plant will remain closed on <date> for <festival>. Regular shifts resume on <date>. Wishing you and your family a happy festival.'],
  ['Safety reminder', 'Safety first', 'A reminder to wear helmets, safety shoes and gloves at all times on the shop floor. Report any unsafe condition to your supervisor immediately.'],
  ['Payslips released', 'Salary slips are ready', 'Salary slips for <month> are now available in the HRMS under Payroll. Please check them and contact HR within 3 days if anything looks wrong.'],
  ['Attendance reminder', 'Punch in and out every day', 'Please remember to punch in and out on the biometric device every day. Days with a missing punch count as absent until a regularization is approved.'],
  ['Policy update', 'Policy update', 'We have updated the <policy name>. The key change is <change>. It applies from <date>. Reach out to HR with any questions.']
];

export default function MessageCenter() {
  const { user } = useAuth();
  const isAdmin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);
  const [audience, setAudience] = useState('ALL');
  const [departments, setDepartments] = useState([]);
  const [selected, setSelected] = useState([]);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [brief, setBrief] = useState('');
  const [channels, setChannels] = useState({ email: true, whatsapp: true, inApp: true });
  const [reach, setReach] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);
  const [aiUsed, setAiUsed] = useState(null);

  const { data: employeesData } = useApi('/employees', []);
  const employees = (employeesData?.employees || []).filter((e) => e.status !== 'OFFBOARDED');
  const departmentList = useMemo(() => [...new Set(employees.map((e) => e.department).filter(Boolean))].sort(), [employees]);
  const { data: history, reload: reloadHistory } = useApi(isAdmin ? '/integrations/logs?event=CUSTOM&limit=12' : '', [isAdmin], { skeleton: false });

  const audiencePayload = useMemo(() => ({ type: audience, departments, employeeIds: selected }), [audience, departments, selected]);

  useEffect(() => {
    let alive = true;
    if ((audience === 'DEPARTMENT' && !departments.length) || (audience === 'SELECTED' && !selected.length)) { setReach(null); return undefined; }
    const t = setTimeout(() => {
      post('/messages/preview', { audience: audiencePayload }, { toast: false }).then((r) => { if (alive) setReach(r); }).catch(() => { if (alive) setReach(null); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [audiencePayload]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setSending(true); setSent(null);
    try {
      const r = await post('/messages/broadcast', { audience: audiencePayload, subject, message, channels }, { loadingMessage: 'Queuing your message…' });
      setSent(r);
      reloadHistory?.();
    } catch (_) { /* toast shown */ } finally { setSending(false); }
  }

  const visiblePeople = employees.filter((e) => `${e.firstName} ${e.lastName || ''} ${e.employeeCode} ${e.department || ''}`.toLowerCase().includes(peopleQuery.toLowerCase()));
  const toggleId = (id) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const canSend = message.trim() && (channels.email || channels.whatsapp || channels.inApp) && (reach?.count || 0) > 0;
  const preview = message.trim() || 'Your message preview appears here as you type.';

  return (
    <div className="v26-page">
      <section className="v26-hero page-intro">
        <div>
          <span className="v26-kicker"><Icon name="Megaphone" size={14} /> Communication</span>
          <h1>Message Center</h1>
          <p>Send one message to everyone, a location, a department or chosen people — by email, WhatsApp and in-app notification together. Gemini can draft, polish or translate it into Hindi and Bengali for the shop floor.</p>
        </div>
      </section>

      <div className="v26-compose">
        <section className="v26-card">
          <div className="v26-card-head"><div><h2>Compose</h2><small>Delivery runs in the background; follow progress in Integrations → Delivery log.</small></div></div>
          <div className="v26-card-body" style={{ display: 'grid', gap: 16 }}>
            <div>
              <div className="v26-field" style={{ marginBottom: 8 }}>Send to</div>
              <div className="v26-chiprow">{AUDIENCES.map(([key, icon, label]) => <button type="button" key={key} className={`v26-chip ${audience === key ? 'active' : ''}`} onClick={() => setAudience(key)}><Icon name={icon} size={14} /> {label}</button>)}</div>
            </div>
            {audience === 'DEPARTMENT' && (
              <div className="v26-chiprow">{departmentList.length ? departmentList.map((d) => <button type="button" key={d} className={`v26-chip ${departments.includes(d) ? 'active' : ''}`} onClick={() => setDepartments((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]))}>{d}</button>) : <span className="v26-empty" style={{ padding: 8 }}>No departments on employee records yet.</span>}</div>
            )}
            {audience === 'SELECTED' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <input placeholder="Search people" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} style={{ height: 38, borderRadius: 11, border: '1px solid var(--line)', padding: '0 10px' }} />
                <div className="v26-people-pick">
                  {visiblePeople.map((e) => <label key={e._id}><input type="checkbox" checked={selected.includes(e._id)} onChange={() => toggleId(e._id)} /> <b>{e.firstName} {e.lastName || ''}</b> <small style={{ color: 'var(--muted)' }}>{e.employeeCode} · {e.department || e.workLocation}</small></label>)}
                </div>
                <small style={{ color: 'var(--muted)', fontWeight: 700 }}>{selected.length} selected</small>
              </div>
            )}

            <div className="v26-test" style={{ alignItems: 'stretch', flexDirection: 'column' }}>
              <label className="v26-field">Ask Gemini to write it
                <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Plant closed on Saturday for furnace maintenance, office works normally" />
              </label>
              <div className="v26-actions">
                <AiButton endpoint="/ai/notices/draft" body={() => ({ brief, audience: AUDIENCES.find((a) => a[0] === audience)?.[2] })} disabled={!brief.trim()} label="Write with Gemini" onResult={(r) => { setSubject(r.data?.title || subject); setMessage(r.data?.body || message); setAiUsed(r); }} />
                <AiButton endpoint="/ai/polish" body={() => ({ text: message, purpose: 'GENERAL' })} disabled={!message.trim()} label="Polish" small onResult={(r) => { setMessage(r.text); setAiUsed(r); }} />
                <AiButton endpoint="/ai/translate" body={() => ({ text: message, target: 'hi' })} disabled={!message.trim()} label="हिन्दी" small onResult={(r) => { setMessage(`${message}\n\n${r.text}`); setAiUsed(r); }} />
                <AiButton endpoint="/ai/translate" body={() => ({ text: message, target: 'bn' })} disabled={!message.trim()} label="বাংলা" small onResult={(r) => { setMessage(`${message}\n\n${r.text}`); setAiUsed(r); }} />
                {aiUsed && <GeminiBadge used={aiUsed.usedAi} model={aiUsed.model} compact />}
              </div>
            </div>

            <label className="v26-field">Subject (email title and bold first line on WhatsApp)<input value={subject} maxLength={160} onChange={(e) => setSubject(e.target.value)} placeholder="Plant maintenance on Saturday" /></label>
            <label className="v26-field">Message<textarea value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} placeholder="Write the message people will receive" style={{ minHeight: 170 }} /><small>{message.length}/4000 characters{channels.whatsapp && message.length > 1000 ? ' · long for WhatsApp; consider shortening' : ''}</small></label>
            <div className="v26-chiprow">
              <span className="v26-field" style={{ alignSelf: 'center', marginRight: 4 }}>Starters:</span>
              {STARTERS.map(([label, subj, body]) => <button type="button" key={label} className="v26-chip" onClick={() => { setSubject(subj); setMessage(body); }}>{label}</button>)}
            </div>
            <div>
              <div className="v26-field" style={{ marginBottom: 8 }}>Channels</div>
              <div className="v26-grid three">
                {[['email', 'Mail', 'Email', 'Branded HTML email'], ['whatsapp', 'MessageCircle', 'WhatsApp', 'To the mobile on file'], ['inApp', 'Bell', 'In-app', 'Bell + mobile app']].map(([key, icon, label, hint]) => (
                  <label key={key} className="v26-switch"><input type="checkbox" checked={channels[key]} onChange={(e) => setChannels((c) => ({ ...c, [key]: e.target.checked }))} /><span><b><Icon name={icon} size={13} /> {label}</b><small>{hint}</small></span></label>
                ))}
              </div>
            </div>
            {reach && <div className="v26-reach"><div><b>{reach.count}</b><span>People</span></div><div><b>{reach.withEmail}</b><span>With email</span></div><div><b>{reach.withPhone}</b><span>With mobile</span></div></div>}
            {sent && <div className="v26-note good"><Icon name="CircleCheck" size={16} /><div><b>{sent.message}.</b> {sent.queued} message(s) queued{sent.skipped ? `, ${sent.skipped} skipped (no email / mobile on file)` : ''}.</div></div>}
            <div className="v26-actions">
              <button type="button" className="v26-btn" onClick={send} disabled={!canSend || sending}><Icon name="SendHorizontal" size={16} /> {sending ? 'Sending…' : `Send to ${reach?.count || 0} ${reach?.count === 1 ? 'person' : 'people'}`}</button>
              <button type="button" className="v26-btn secondary" onClick={() => { setSubject(''); setMessage(''); setBrief(''); setSent(null); setAiUsed(null); }}>Clear</button>
            </div>
          </div>
        </section>

        <div style={{ display: 'grid', gap: 16 }}>
          <section className="v26-card">
            <div className="v26-card-head"><div><h2>Preview</h2><small>How it will look</small></div></div>
            <div className="v26-card-body" style={{ display: 'grid', gap: 14 }}>
              {channels.whatsapp && <div className="v26-preview-phone"><div className="v26-bubble">{subject ? <b>{subject}{'\n'}</b> : null}{preview}<small>{formatTime(new Date())} ✓✓</small></div></div>}
              {channels.email && <div className="v26-mail-preview"><div className="v26-mail-top"><b>{subject || 'Message from HR'}</b><br />To: {reach?.sample?.[0] || 'Employee'}{reach?.count > 1 ? ` and ${reach.count - 1} more` : ''}</div><div className="v26-mail-body">{preview}</div></div>}
            </div>
          </section>
          {isAdmin && (
            <section className="v26-card">
              <div className="v26-card-head"><div><h2>Recently sent</h2><small>Last company messages</small></div></div>
              <div className="v26-card-body">
                {!history?.rows?.length ? <div className="v26-empty">Nothing sent yet.</div> : (
                  <div className="v26-list">{history.rows.map((r) => <div className="v26-row" key={r._id}><Icon name={r.channel === 'EMAIL' ? 'Mail' : 'MessageCircle'} size={16} /><div><b>{r.subject || String(r.body || '').slice(0, 60)}</b><small>{r.recipientName} · {formatDateTime(r.createdAt)}</small></div><span className={`v26-pill ${r.status}`}>{String(r.status).toLowerCase()}</span></div>)}</div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
