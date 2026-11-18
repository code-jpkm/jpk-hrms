import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from '../lib/router.jsx';
import '../styles/v26.css';
import '../styles/attendance.css';
import Icon from '../components/Icon.jsx';
import { api, post, put } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { loadAiStatus } from '../components/AiKit.jsx';
import { formatDateTime } from '../utils/time.js';

const EMAIL_PROVIDERS = [
  { id: 'BREVO', name: 'Brevo', hint: 'Free 300 mails/day. Works on Render free plan (HTTPS).' },
  { id: 'RESEND', name: 'Resend', hint: 'Developer-friendly API. HTTPS, works on Render.' },
  { id: 'SENDGRID', name: 'SendGrid', hint: 'Twilio SendGrid API. HTTPS, works on Render.' },
  { id: 'SMTP', name: 'SMTP', hint: 'Gmail / Google Workspace / Zoho / Outlook. Blocked on Render free plan.' }
];
const WA_PROVIDERS = [
  { id: 'META', name: 'WhatsApp Cloud API', hint: 'Official Meta API. Needs approved templates for alerts.' },
  { id: 'MAYTAPI', name: 'Maytapi', hint: 'Uses a linked WhatsApp number. Free-form text, no templates.' }
];
const TABS = [
  ['email', 'Mail', 'Email'],
  ['whatsapp', 'MessageCircle', 'WhatsApp'],
  ['ai', 'Sparkles', 'Gemini AI'],
  ['rules', 'Workflow', 'Notification rules'],
  ['log', 'History', 'Delivery log']
];

function Switch({ checked, onChange, title, hint }) {
  return (
    <label className="v26-switch">
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{title}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

function Field({ label, hint, children, span }) {
  return <label className={`v26-field ${span ? 'v26-span' : ''}`}>{label}{children}{hint && <small>{hint}</small>}</label>;
}

function SecretInput({ masked, value, onChange, placeholder }) {
  return <input type="password" autoComplete="new-password" value={value} placeholder={masked ? `Saved (${masked}) — type to replace` : placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function LastTest({ test }) {
  if (!test) return <span className="v26-dot off">Not tested yet</span>;
  return <span className={`v26-dot ${test.ok ? 'on' : 'bad'}`} title={test.message}>{test.ok ? 'Test passed' : 'Test failed'} · {formatDateTime(test.at)}</span>;
}

function EmailTab({ view, onSaved, onRefresh }) {
  const { user } = useAuth();
  const e = view.email;
  const [form, setForm] = useState(() => ({ enabled: e.enabled, provider: e.provider || 'BREVO', fromName: e.fromName || '', fromEmail: e.fromEmail || '', replyTo: e.replyTo || '', apiKey: '', smtp: { host: e.smtp?.host || '', port: e.smtp?.port || 587, secure: Boolean(e.smtp?.secure), user: e.smtp?.user || '', pass: '' } }));
  const [to, setTo] = useState(user?.email || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setSmtp = (patch) => setForm((f) => ({ ...f, smtp: { ...f.smtp, ...patch } }));

  async function save() {
    setBusy(true);
    try { await put('/integrations/email', form, { loadingMessage: 'Saving email settings…', successMessage: 'Email settings saved' }); set({ apiKey: '', smtp: { ...form.smtp, pass: '' } }); onSaved(); } catch (_) { /* toast */ } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setResult(null);
    try { const r = await post('/integrations/email/test', { to }, { toast: false }); setResult({ ok: true, text: r.message }); } catch (err) { setResult({ ok: false, text: err.message }); } finally { setBusy(false); onRefresh(); }
  }

  return (
    <div className="v26-card-body" style={{ display: 'grid', gap: 16 }}>
      <div className="v26-note warn"><Icon name="Info" size={16} /><div><b>Hosting on Render's free plan?</b> Render blocks outbound SMTP ports (25, 465, 587) on free web services since September 2025, so Gmail/SMTP times out there. Choose <b>Brevo</b>, <b>Resend</b> or <b>SendGrid</b> — they send over HTTPS and work everywhere.</div></div>
      <Switch checked={form.enabled} onChange={(v) => set({ enabled: v })} title="Send email from the HRMS" hint="Leave approvals, payslips, invites, wishes, notices and alerts." />
      <div className="v26-provider-grid">
        {EMAIL_PROVIDERS.map((p) => <button type="button" key={p.id} className={`v26-provider ${form.provider === p.id ? 'active' : ''}`} onClick={() => set({ provider: p.id })}><b>{p.name}</b><small>{p.hint}</small></button>)}
      </div>
      <div className="v26-grid three">
        <Field label="Sender name" hint="Shown in the inbox, e.g. JPK HR"><input value={form.fromName} onChange={(ev) => set({ fromName: ev.target.value })} placeholder="JPK Metallics HR" /></Field>
        <Field label="Sender email" hint={form.provider === 'SMTP' ? 'Usually the SMTP username' : 'Must be a verified sender / domain in your provider'}><input type="email" value={form.fromEmail} onChange={(ev) => set({ fromEmail: ev.target.value })} placeholder="hr@jpkm.in" /></Field>
        <Field label="Reply-to (optional)"><input type="email" value={form.replyTo} onChange={(ev) => set({ replyTo: ev.target.value })} placeholder="hr@jpkm.in" /></Field>
      </div>
      {form.provider === 'SMTP' ? (
        <div className="v26-grid three">
          <Field label="SMTP host" hint="Gmail: smtp.gmail.com · Zoho: smtp.zoho.in · Outlook: smtp.office365.com"><input value={form.smtp.host} onChange={(ev) => setSmtp({ host: ev.target.value })} placeholder="smtp.gmail.com" /></Field>
          <Field label="Port" hint="587 (STARTTLS) or 465 (SSL)"><input type="number" value={form.smtp.port} onChange={(ev) => setSmtp({ port: ev.target.value, secure: Number(ev.target.value) === 465 })} /></Field>
          <Field label="Username"><input value={form.smtp.user} onChange={(ev) => setSmtp({ user: ev.target.value })} placeholder="hr@jpkm.in" /></Field>
          <Field label="Password / App password" hint="For Gmail, create an App Password (Google account → Security → 2-Step Verification → App passwords)." span><SecretInput masked={e.smtp?.passMasked} value={form.smtp.pass} onChange={(v) => setSmtp({ pass: v })} placeholder="16-character app password" /></Field>
        </div>
      ) : (
        <Field label={`${EMAIL_PROVIDERS.find((p) => p.id === form.provider)?.name} API key`} hint={form.provider === 'BREVO' ? 'Brevo → Settings → SMTP & API → API keys (starts with xkeysib-).' : form.provider === 'RESEND' ? 'Resend → API Keys (starts with re_). Verify your domain first.' : 'SendGrid → Settings → API Keys with Mail Send permission (starts with SG.).'}>
          <SecretInput masked={e.apiKeyMasked} value={form.apiKey} onChange={(v) => set({ apiKey: v })} placeholder="Paste the API key" />
        </Field>
      )}
      <div className="v26-actions">
        <button type="button" className="v26-btn" onClick={save} disabled={busy}><Icon name="Save" size={16} /> Save email settings</button>
        <LastTest test={e.lastTest} />
        {e.source === 'environment' && e.configured && <span className="v26-dot warn">Using server .env values</span>}
      </div>
      <div className="v26-test">
        <Field label="Send a test email to"><input type="email" value={to} onChange={(ev) => setTo(ev.target.value)} /></Field>
        <button type="button" className="v26-btn secondary" onClick={test} disabled={busy || !to}><Icon name="Send" size={15} /> Send test</button>
      </div>
      {result && <div className={`v26-note ${result.ok ? 'good' : 'bad'}`}><Icon name={result.ok ? 'CircleCheck' : 'TriangleAlert'} size={16} /><div>{result.text}</div></div>}
    </div>
  );
}

function WhatsappTab({ view, onSaved, onRefresh }) {
  const { user } = useAuth();
  const w = view.whatsapp;
  const [form, setForm] = useState(() => ({ enabled: w.enabled, provider: w.provider || 'MAYTAPI', defaultCountryCode: w.defaultCountryCode || '91', meta: { phoneNumberId: w.meta?.phoneNumberId || '', businessAccountId: w.meta?.businessAccountId || '', apiVersion: w.meta?.apiVersion || 'v26.0', accessToken: '', appSecret: '', verifyToken: w.meta?.verifyToken || '', templateLanguage: w.meta?.templateLanguage || 'en' }, maytapi: { productId: w.maytapi?.productId || '', phoneId: w.maytapi?.phoneId || '', token: '' }, templates: w.templates || {} }));
  const [to, setTo] = useState(user?.phone || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setMeta = (patch) => setForm((f) => ({ ...f, meta: { ...f.meta, ...patch } }));
  const setMay = (patch) => setForm((f) => ({ ...f, maytapi: { ...f.maytapi, ...patch } }));
  const setTemplate = (key, patch) => setForm((f) => ({ ...f, templates: { ...f.templates, [key]: { ...(f.templates[key] || {}), ...patch } } }));

  async function save() {
    setBusy(true);
    try { await put('/integrations/whatsapp', form, { loadingMessage: 'Saving WhatsApp settings…', successMessage: 'WhatsApp settings saved' }); setMeta({ accessToken: '', appSecret: '' }); setMay({ token: '' }); onSaved(); } catch (_) { /* toast */ } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setResult(null);
    try { const r = await post('/integrations/whatsapp/test', { to, mode: form.provider === 'META' ? 'template' : 'text' }, { toast: false }); setResult({ ok: true, text: r.message }); } catch (err) { setResult({ ok: false, text: err.message }); } finally { setBusy(false); onRefresh(); }
  }

  return (
    <div className="v26-card-body" style={{ display: 'grid', gap: 16 }}>
      <Switch checked={form.enabled} onChange={(v) => set({ enabled: v })} title="Send WhatsApp messages" hint="Numbers are converted automatically: 98300 12345 → +91 98300 12345." />
      <div className="v26-provider-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {WA_PROVIDERS.map((p) => <button type="button" key={p.id} className={`v26-provider ${form.provider === p.id ? 'active' : ''}`} onClick={() => set({ provider: p.id })}><b>{p.name}</b><small>{p.hint}</small></button>)}
      </div>
      <div className="v26-grid three">
        <Field label="Default country code" hint="Added to 10-digit numbers"><input value={form.defaultCountryCode} onChange={(ev) => set({ defaultCountryCode: ev.target.value })} /></Field>
      </div>
      {form.provider === 'MAYTAPI' ? (
        <div className="v26-grid three">
          <Field label="Product ID" hint="Maytapi dashboard → Settings"><input value={form.maytapi.productId} onChange={(ev) => setMay({ productId: ev.target.value })} /></Field>
          <Field label="Phone ID" hint="The linked WhatsApp phone instance"><input value={form.maytapi.phoneId} onChange={(ev) => setMay({ phoneId: ev.target.value })} /></Field>
          <Field label="API token"><SecretInput masked={w.maytapi?.tokenMasked} value={form.maytapi.token} onChange={(v) => setMay({ token: v })} placeholder="x-maytapi-key" /></Field>
        </div>
      ) : (
        <>
          <div className="v26-grid three">
            <Field label="Phone number ID" hint="Meta → WhatsApp → API Setup"><input value={form.meta.phoneNumberId} onChange={(ev) => setMeta({ phoneNumberId: ev.target.value })} /></Field>
            <Field label="WhatsApp Business Account ID"><input value={form.meta.businessAccountId} onChange={(ev) => setMeta({ businessAccountId: ev.target.value })} /></Field>
            <Field label="Graph API version"><input value={form.meta.apiVersion} onChange={(ev) => setMeta({ apiVersion: ev.target.value })} placeholder="v26.0" /></Field>
            <Field label="Permanent access token" hint="Create a System User in Meta Business Settings and generate a token with whatsapp_business_messaging." span><SecretInput masked={w.meta?.accessTokenMasked} value={form.meta.accessToken} onChange={(v) => setMeta({ accessToken: v })} placeholder="EAAG…" /></Field>
            <Field label="App secret (for webhook signatures)"><SecretInput masked={w.meta?.appSecretMasked} value={form.meta.appSecret} onChange={(v) => setMeta({ appSecret: v })} placeholder="Optional" /></Field>
            <Field label="Webhook verify token"><input value={form.meta.verifyToken} onChange={(ev) => setMeta({ verifyToken: ev.target.value })} placeholder="any-long-random-text" /></Field>
            <Field label="Template language"><input value={form.meta.templateLanguage} onChange={(ev) => setMeta({ templateLanguage: ev.target.value })} placeholder="en" /></Field>
          </div>
          {view.webhookUrl && <div><div className="v26-field" style={{ marginBottom: 6 }}>Webhook URL for delivery receipts (Meta → WhatsApp → Configuration)</div><div className="v26-copy"><code>{view.webhookUrl}</code><button type="button" className="v26-btn ghost" onClick={() => navigator.clipboard?.writeText(view.webhookUrl)}><Icon name="Copy" size={14} /> Copy</button></div></div>}
          <div className="v26-note"><Icon name="Info" size={16} /><div>Meta only delivers business-initiated messages through <b>approved templates</b>. Create each template once in WhatsApp Manager (category <b>Utility</b>) using the suggested text below, then enter its name. Events without a template are sent as normal text, which only works within 24 hours of the employee messaging you.</div></div>
          <div className="v26-table-wrap">
            <table className="v26-table">
              <thead><tr><th>Event</th><th>Suggested template text</th><th style={{ width: 210 }}>Template name</th><th style={{ width: 100 }}>Language</th></tr></thead>
              <tbody>
                {(view.catalogue || []).map((ev) => (
                  <tr key={ev.key}>
                    <td><b>{ev.label}</b><small>{ev.audience}</small></td>
                    <td><span className="v26-mono" style={{ whiteSpace: 'normal' }}>{ev.template?.body}</span><small>Suggested name: {ev.template?.name}</small></td>
                    <td><input value={form.templates[ev.key]?.name || ''} placeholder={ev.template?.name} onChange={(e2) => setTemplate(ev.key, { name: e2.target.value })} style={{ height: 36, borderRadius: 10, border: '1px solid var(--line)', padding: '0 8px', width: '100%' }} /></td>
                    <td><input value={form.templates[ev.key]?.language || ''} placeholder={form.meta.templateLanguage || 'en'} onChange={(e2) => setTemplate(ev.key, { language: e2.target.value })} style={{ height: 36, borderRadius: 10, border: '1px solid var(--line)', padding: '0 8px', width: '100%' }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="v26-actions">
        <button type="button" className="v26-btn" onClick={save} disabled={busy}><Icon name="Save" size={16} /> Save WhatsApp settings</button>
        <LastTest test={w.lastTest} />
        {w.source === 'environment' && w.configured && <span className="v26-dot warn">Using server .env values</span>}
      </div>
      <div className="v26-test">
        <Field label="Send a test WhatsApp to" hint={form.provider === 'META' ? 'Uses the pre-approved hello_world template.' : 'Sends a short text message.'}><input value={to} onChange={(ev) => setTo(ev.target.value)} placeholder="98300 12345" /></Field>
        <button type="button" className="v26-btn secondary" onClick={test} disabled={busy || !to}><Icon name="Send" size={15} /> Send test</button>
      </div>
      {result && <div className={`v26-note ${result.ok ? 'good' : 'bad'}`}><Icon name={result.ok ? 'CircleCheck' : 'TriangleAlert'} size={16} /><div>{result.text}</div></div>}
    </div>
  );
}

function AiTab({ view, onSaved, onRefresh }) {
  const a = view.ai;
  const [form, setForm] = useState(() => ({ enabled: a.enabled, model: a.model || 'gemini-flash-latest', apiKey: '', allowProviderStorage: Boolean(a.allowProviderStorage), features: { ...(a.features || {}) } }));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const { data: usage, reload: reloadUsage } = useApi('/integrations/ai/usage', [], { skeleton: false });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setBusy(true);
    try { await put('/integrations/ai', form, { loadingMessage: 'Saving AI settings…', successMessage: 'AI settings saved' }); set({ apiKey: '' }); loadAiStatus(true); onSaved(); } catch (_) { /* toast */ } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setResult(null);
    try { const r = await post('/integrations/ai/test', {}, { toast: false }); setResult({ ok: true, text: r.message }); } catch (err) { setResult({ ok: false, text: err.message }); } finally { setBusy(false); onRefresh(); reloadUsage(); loadAiStatus(true); }
  }

  return (
    <div className="v26-card-body" style={{ display: 'grid', gap: 16 }}>
      <Switch checked={form.enabled} onChange={(v) => set({ enabled: v })} title="Use Gemini across the HRMS" hint="Every AI answer is grounded in records the signed-in person is allowed to see. AI never changes data on its own." />
      <div className="v26-grid three">
        <Field label="Gemini API key" hint="Google AI Studio → Get API key (aistudio.google.com)." span><SecretInput masked={a.apiKeyMasked} value={form.apiKey} onChange={(v) => set({ apiKey: v })} placeholder="AIza…" /></Field>
        <Field label="Model" hint="gemini-flash-latest always points to Google's current Flash model."><input value={form.model} onChange={(ev) => set({ model: ev.target.value })} /></Field>
      </div>
      <Switch checked={form.allowProviderStorage} onChange={(v) => set({ allowProviderStorage: v })} title="Allow Google to store prompts" hint="Off by default: HR data (names, salaries, attendance) is sent with store=false." />
      <div>
        <div className="v26-field" style={{ marginBottom: 8 }}>Features</div>
        <div className="v26-grid three">
          {Object.entries(a.featureLabels || {}).map(([key, label]) => <Switch key={key} checked={form.features[key] !== false} onChange={(v) => set({ features: { ...form.features, [key]: v } })} title={label} />)}
        </div>
      </div>
      <div className="v26-actions">
        <button type="button" className="v26-btn" onClick={save} disabled={busy}><Icon name="Save" size={16} /> Save AI settings</button>
        <button type="button" className="v26-btn secondary" onClick={test} disabled={busy}><Icon name="Zap" size={15} /> Test Gemini</button>
        <LastTest test={a.lastTest} />
        {a.source === 'environment' && a.configured && <span className="v26-dot warn">Using GEMINI_API_KEY from server .env</span>}
      </div>
      {result && <div className={`v26-note ${result.ok ? 'good' : 'bad'}`}><Icon name={result.ok ? 'CircleCheck' : 'TriangleAlert'} size={16} /><div>{result.text}</div></div>}
      {usage?.byFeature?.length > 0 && (
        <div className="v26-table-wrap">
          <table className="v26-table"><thead><tr><th>Feature</th><th className="center">Calls (30 days)</th><th className="center">Failures</th><th className="center">Avg time</th></tr></thead>
            <tbody>{usage.byFeature.map((u) => <tr key={u.feature}><td><b>{a.featureLabels?.[u.feature] || u.feature}</b></td><td className="center">{u.calls}</td><td className="center">{u.failures}</td><td className="center">{(u.avgMs / 1000).toFixed(1)}s</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RulesTab({ view, onSaved }) {
  const [events, setEvents] = useState(() => JSON.parse(JSON.stringify(view.events || {})));
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const m = new Map();
    for (const ev of view.catalogue || []) { if (!m.has(ev.group)) m.set(ev.group, []); m.get(ev.group).push(ev); }
    return [...m.entries()];
  }, [view.catalogue]);
  const toggle = (key, channel, value) => setEvents((e) => ({ ...e, [key]: { ...(e[key] || {}), [channel]: value } }));
  async function save() {
    setBusy(true);
    try { await put('/integrations/events', { events }, { loadingMessage: 'Saving notification rules…', successMessage: 'Notification rules saved' }); onSaved(); } catch (_) { /* toast */ } finally { setBusy(false); }
  }
  const isOn = (k, ch) => (ch === 'inApp' ? events[k]?.inApp !== false : Boolean(events[k]?.[ch]));
  const Cell = ({ k, ch }) => <td className="center"><input type="checkbox" aria-label={`${k} ${ch}`} checked={isOn(k, ch)} onChange={(e) => toggle(k, ch, e.target.checked)} style={{ width: 18, height: 18 }} /></td>;
  return (
    <div className="v26-card-body" style={{ display: 'grid', gap: 14 }}>
      <div className="v26-note"><Icon name="Info" size={16} /><div>Choose which events reach people on which channel. Email and WhatsApp only go out when that channel is connected and switched on; in-app alerts always work. People without an email address or mobile number are skipped and shown in the delivery log.</div></div>
      <div className="v26-table-wrap">
        <table className="v26-table">
          <thead><tr><th>Event</th><th>Who receives it</th><th className="center"><Icon name="Mail" size={14} /> Email</th><th className="center"><Icon name="MessageCircle" size={14} /> WhatsApp</th><th className="center"><Icon name="Bell" size={14} /> In-app</th></tr></thead>
          <tbody>
            {groups.map(([group, list]) => (
              <React.Fragment key={group}>
                <tr className="v26-group-row"><td colSpan="5">{group}</td></tr>
                {list.map((ev) => <tr key={ev.key}><td><b>{ev.label}</b></td><td><small style={{ marginTop: 0 }}>{ev.audience}</small></td><Cell k={ev.key} ch="email" /><Cell k={ev.key} ch="whatsapp" /><Cell k={ev.key} ch="inApp" /></tr>)}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="v26-actions"><button type="button" className="v26-btn" onClick={save} disabled={busy}><Icon name="Save" size={16} /> Save rules</button></div>
    </div>
  );
}

function LogTab() {
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const path = `/integrations/logs?page=${page}&limit=40${channel ? `&channel=${channel}` : ''}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const { data, loading, reload } = useApi(path, [path], { skeleton: false });
  const rows = data?.rows || [];
  const stat = (ch, st) => (data?.stats || []).filter((s) => (!ch || s.channel === ch) && st.includes(s.status)).reduce((n, s) => n + s.count, 0);
  async function retry(id) {
    try { await post(`/integrations/logs/${id}/retry`, {}, { loadingMessage: 'Retrying…' }); reload(); } catch (_) { /* toast */ }
  }
  return (
    <div className="v26-card-body" style={{ display: 'grid', gap: 14 }}>
      <div className="v26-stats">
        <div className="v26-stat"><b>{stat('EMAIL', ['SENT', 'DELIVERED', 'READ'])}</b><span>Emails sent (30 days)</span></div>
        <div className="v26-stat"><b>{stat('WHATSAPP', ['SENT', 'DELIVERED', 'READ'])}</b><span>WhatsApp sent (30 days)</span></div>
        <div className="v26-stat"><b>{stat('', ['FAILED'])}</b><span>Failed</span></div>
        <div className="v26-stat"><b>{stat('', ['SKIPPED'])}</b><span>Skipped (not configured / no contact)</span></div>
      </div>
      <div className="v26-filters">
        <select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }}><option value="">All channels</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option></select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="SENT,DELIVERED,READ">Sent</option><option value="QUEUED,SENDING">Queued</option><option value="FAILED">Failed</option><option value="SKIPPED">Skipped</option></select>
        <input placeholder="Search name, email, number" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <button type="button" className="v26-btn secondary" onClick={() => reload()}><Icon name="RefreshCw" size={14} /> Refresh</button>
      </div>
      {loading && !rows.length ? <div className="att-skeleton" style={{ minHeight: 200 }} /> : !rows.length ? <div className="v26-empty">No messages yet.</div> : (
        <div className="v26-table-wrap">
          <table className="v26-table">
            <thead><tr><th>When</th><th>Channel</th><th>Event</th><th>To</th><th>Subject / message</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.createdAt)}</td>
                  <td><Icon name={r.channel === 'EMAIL' ? 'Mail' : 'MessageCircle'} size={15} /></td>
                  <td><span className="v26-mono">{String(r.event || '').replaceAll('_', ' ').toLowerCase()}</span></td>
                  <td><b>{r.recipientName || '—'}</b><small>{r.to || 'no contact'}</small></td>
                  <td style={{ maxWidth: 360 }}><span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.subject || r.body}</span>{r.error && <small style={{ color: 'var(--bad)' }}>{r.error}</small>}</td>
                  <td><span className={`v26-pill ${r.status}`}>{String(r.status).toLowerCase()}</span>{r.attempts > 1 && <small>{r.attempts} attempts</small>}</td>
                  <td>{['FAILED', 'SKIPPED'].includes(r.status) && <button type="button" className="v26-btn ghost" onClick={() => retry(r._id)}><Icon name="RotateCcw" size={14} /> Retry</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.limit && (
        <div className="v26-actions">
          <button type="button" className="v26-btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><Icon name="ChevronLeft" size={14} /> Newer</button>
          <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 700 }}>Page {page} of {Math.ceil(data.total / data.limit)}</span>
          <button type="button" className="v26-btn secondary" disabled={page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)}>Older <Icon name="ChevronRight" size={14} /></button>
        </div>
      )}
    </div>
  );
}

export default function Integrations() {
  const location = useLocation();
  const [tab, setTab] = useState('email');
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);

  async function load() {
    try { const v = await api('/integrations', { toast: false }); setView(v); setError(null); } catch (err) { setError(err); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const h = location.hash.replace('#', '');
    if (TABS.some(([k]) => k === h)) setTab(h);
  }, [location.hash]);
  const reloadView = async () => { await load(); setVersion((v) => v + 1); };

  const statusOf = (s) => (!s ? 'off' : !s.enabled ? 'off' : s.configured ? 'on' : 'warn');
  const label = (s) => (!s ? '…' : !s.enabled ? 'Switched off' : s.configured ? 'Connected' : 'Not set up');

  return (
    <div className="v26-page">
      <section className="v26-hero page-intro">
        <div>
          <span className="v26-kicker"><Icon name="PlugZap" size={14} /> Company settings</span>
          <h1>Integrations</h1>
          <p>Connect email, WhatsApp and Google Gemini once, and the HRMS uses them everywhere: leave and attendance approvals, payslips, invites, notices, birthday wishes, reminders and AI summaries.</p>
        </div>
      </section>
      {error && <div className="v26-note bad"><Icon name="TriangleAlert" size={16} /><div>{error.message}</div></div>}
      <div className="v26-status-row">
        <button type="button" className="v26-status mail" onClick={() => setTab('email')}><i><Icon name="Mail" size={20} /></i><div><b>Email</b><small>{view?.email?.provider ? `${view.email.provider}${view.email.fromEmail ? ` · ${view.email.fromEmail}` : ''}` : 'Not configured'}</small></div><span className={`v26-dot ${statusOf(view?.email)}`}>{label(view?.email)}</span></button>
        <button type="button" className="v26-status wa" onClick={() => setTab('whatsapp')}><i><Icon name="MessageCircle" size={20} /></i><div><b>WhatsApp</b><small>{view?.whatsapp?.provider === 'MAYTAPI' ? 'Maytapi' : 'WhatsApp Cloud API'}</small></div><span className={`v26-dot ${statusOf(view?.whatsapp)}`}>{label(view?.whatsapp)}</span></button>
        <button type="button" className="v26-status ai" onClick={() => setTab('ai')}><i><Icon name="Sparkles" size={20} /></i><div><b>Gemini AI</b><small>{view?.ai?.model || 'gemini-flash-latest'}</small></div><span className={`v26-dot ${statusOf(view?.ai)}`}>{label(view?.ai)}</span></button>
      </div>
      <section className="v26-card">
        <div className="v26-card-head">
          <div className="v26-tabs" role="tablist">
            {TABS.map(([key, icon, text]) => <button type="button" key={key} role="tab" className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon name={icon} size={15} /> {text}</button>)}
          </div>
        </div>
        {!view ? <div className="v26-card-body"><div className="att-skeleton" style={{ minHeight: 320 }} /></div> : (
          <React.Fragment key={version}>
            {tab === 'email' && <EmailTab view={view} onSaved={reloadView} onRefresh={load} />}
            {tab === 'whatsapp' && <WhatsappTab view={view} onSaved={reloadView} onRefresh={load} />}
            {tab === 'ai' && <AiTab view={view} onSaved={reloadView} onRefresh={load} />}
            {tab === 'rules' && <RulesTab view={view} onSaved={reloadView} />}
            {tab === 'log' && <LogTab />}
          </React.Fragment>
        )}
      </section>
    </div>
  );
}
