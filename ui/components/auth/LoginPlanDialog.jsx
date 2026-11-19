import React, { useEffect, useState } from 'react';
import Icon from '../Icon.jsx';
import { api, post } from '../../api/client.js';
import '../../styles/login.css';

const verb = (n, one, many) => (n === 1 ? one : many);

function Names({ rows, max = 8 }) {
  const [all, setAll] = useState(false);
  const list = all ? rows : rows.slice(0, max);
  return (
    <span className="login-plan-names">
      {list.map((r) => r.name || r.email).join(', ')}
      {rows.length > max && !all && <> … <button type="button" onClick={() => setAll(true)}>show all {rows.length}</button></>}
    </span>
  );
}

/**
 * "Send login details to everyone": shows who gets what before anything is sent.
 * People with no login get one (by their email), logins without a password get
 * a temporary password, and people who never used theirs can get a new one.
 */
export default function LoginPlanDialog({ onClose, onDone }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [includeWaiting, setIncludeWaiting] = useState(false);
  const [includeReady, setIncludeReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/employees/login-details/plan').then(setPlan).catch((e) => setError(e.message || 'Could not load the list.'));
  }, []);

  const c = plan?.counts || {};
  const total = (c.create || 0) + (c.send || 0) + (includeWaiting ? c.waiting || 0 : 0) + (includeReady ? c.ready || 0 : 0);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const result = await post('/employees/login-details/send-all', { includeWaiting, includeReady }, { toast: false });
      onDone(result);
    } catch (e) {
      setError(e.message || 'Could not send the login details.');
      setBusy(false);
    }
  }

  return (
    <div className="login-details-backdrop" role="dialog" aria-modal="true" aria-labelledby="login-plan-title" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section className="login-details login-plan">
        <header>
          <Icon name="KeyRound" size={20} />
          <h2 id="login-plan-title">Send login details to everyone</h2>
          <button type="button" className="icon-btn jpk-auth-iconbtn" onClick={onClose} aria-label="Close" disabled={busy}><Icon name="X" size={18} /></button>
        </header>
        <p>Each person gets a temporary password by email and WhatsApp, with the sign-in link. They choose their own password the first time they sign in. If a message cannot reach someone, you get their password to hand over.</p>
        {error && <p className="warn">{error}</p>}
        {!plan && !error && <p className="login-plan-loading"><Icon name="Loader2" size={15} /> Checking who can sign in…</p>}
        {plan && (
          <ul className="login-plan-groups">
            {c.create > 0 && <li><b>{c.create}</b> {verb(c.create, 'has', 'have')} no login yet. A login is made with the email in their profile. <Names rows={plan.create} /></li>}
            {c.send > 0 && <li><b>{c.send}</b> {verb(c.send, 'has', 'have')} a login but no password yet. <Names rows={plan.send} /></li>}
            {c.waiting > 0 && (
              <li className="opt">
                <label>
                  <input type="checkbox" checked={includeWaiting} onChange={(e) => setIncludeWaiting(e.target.checked)} disabled={busy} />
                  <span>Also send a new password to <b>{c.waiting}</b> {c.waiting === 1 ? 'person who' : 'people who'} got login details before but never signed in. Their old temporary password stops working. <Names rows={plan.waiting} /></span>
                </label>
              </li>
            )}
            {c.ready > 0 && (
              <li className="opt">
                <label>
                  <input type="checkbox" checked={includeReady} onChange={(e) => setIncludeReady(e.target.checked)} disabled={busy} />
                  <span><b>{c.ready}</b> already {verb(c.ready, 'has', 'have')} a password, so {verb(c.ready, 'this person is', 'they are')} left alone. Tick to give them a new temporary one too: their current password stops working. Only do this if they don't know it, for example from the old system. <Names rows={plan.ready} /></span>
                </label>
              </li>
            )}
            {c.noEmail > 0 && <li className="warn"><b>{c.noEmail}</b> {verb(c.noEmail, 'has', 'have')} no email in their profile, so {verb(c.noEmail, 'cannot', 'they cannot')} get a login yet. Add an email to their profile first: <Names rows={plan.noEmail} /></li>}
            {c.disabled > 0 && <li className="muted"><b>{c.disabled}</b> {verb(c.disabled, 'has', 'have')} their login turned off, so {verb(c.disabled, 'is', 'they are')} left out. To turn one on and send, use 🔑 Send login details on that person's profile: <Names rows={plan.disabled} /></li>}
            {c.admins > 0 && <li className="muted"><b>{c.admins}</b> admin {c.admins === 1 ? 'login' : 'logins'}: only a Super Admin can send these.</li>}
            {!c.create && !c.send && !c.waiting && <li className="muted">Everyone with an email can already sign in.</li>}
          </ul>
        )}
        <footer>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="primary" onClick={send} disabled={!plan || busy || total === 0}>
            {busy ? 'Sending…' : total ? `Send to ${total} ${total === 1 ? 'person' : 'people'}` : 'Nobody to send to'}
          </button>
        </footer>
      </section>
    </div>
  );
}
