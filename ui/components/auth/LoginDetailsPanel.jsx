import React, { useState } from 'react';
import toast from 'react-hot-toast';
import Icon from '../Icon.jsx';
import '../../styles/login.css';

const STATUS = {
  SENT: { label: 'sent', tone: 'ok' },
  DELIVERED: { label: 'delivered', tone: 'ok' },
  READ: { label: 'read', tone: 'ok' },
  PENDING: { label: 'sending', tone: 'ok' },
  QUEUED: { label: 'queued', tone: 'ok' },
  SENDING: { label: 'sending', tone: 'ok' },
  SKIPPED: { label: 'not sent', tone: 'warn' },
  FAILED: { label: 'failed', tone: 'warn' }
};

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied');
  } catch {
    toast.error('Could not copy. Select the text and copy it yourself.');
  }
}

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Name', 'Employee code', 'Login email', 'Temporary password'].map(esc).join(',')];
  for (const r of rows) lines.push([r.name, r.employeeCode, r.email, r.temporaryPassword].map(esc).join(','));
  return lines.join('\r\n');
}

function downloadCsv(rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hrms-login-details-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Shown to HR after "Send login details": the temporary password appears once,
 * with what happened to the email / WhatsApp message. Also used for the
 * "everyone without a password" result.
 */
export default function LoginDetailsPanel({ result, onClose }) {
  const [shown, setShown] = useState(true);
  if (!result) return null;
  const bulk = Array.isArray(result.results);
  const handOver = bulk ? result.results.filter((r) => r.temporaryPassword) : [];

  return (
    <div className="login-details-backdrop" role="dialog" aria-modal="true" aria-labelledby="login-details-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="login-details">
        <header>
          <Icon name="KeyRound" size={20} />
          <h2 id="login-details-title">{bulk ? 'Login details sent' : 'Login details'}</h2>
          <button type="button" className="icon-btn jpk-auth-iconbtn" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </header>
        <p className={result.loginDelivered === false || handOver.length ? 'warn' : ''}>{result.message}</p>

        {!bulk && result.temporaryPassword && (
          <div className="login-details-secret">
            <div>
              <span>Login</span>
              <b>{result.loginEmail || '—'}</b>
            </div>
            <div>
              <span>Temporary password</span>
              <b className="mono">{shown ? result.temporaryPassword : '••••••••••'}</b>
            </div>
            <div className="login-details-actions">
              <button type="button" className="secondary" onClick={() => setShown((v) => !v)}><Icon name={shown ? 'EyeOff' : 'Eye'} size={14} /> {shown ? 'Hide' : 'Show'}</button>
              <button type="button" className="secondary" onClick={() => copy(`Login: ${result.loginEmail}\nTemporary password: ${result.temporaryPassword}`)}><Icon name="Copy" size={14} /> Copy</button>
            </div>
            <small>Shown only now. The employee must choose their own password after signing in.</small>
          </div>
        )}

        {!bulk && Array.isArray(result.notificationLogs) && result.notificationLogs.length > 0 && (
          <ul className="login-details-channels">
            {result.notificationLogs.map((log, i) => {
              const s = STATUS[log.status] || { label: String(log.status || '').toLowerCase(), tone: 'warn' };
              return <li key={i} className={s.tone}><Icon name={log.channel === 'EMAIL' ? 'Mail' : 'MessageCircle'} size={14} /> {log.channel === 'EMAIL' ? 'Email' : 'WhatsApp'} {log.to ? `to ${log.to}` : ''}: <b>{s.label}</b>{log.error ? <em> — {log.error}</em> : null}</li>;
            })}
          </ul>
        )}

        {bulk && result.results.length > 0 && (
          <>
            <div className="login-details-table">
              <table>
                <thead><tr><th>Name</th><th>Code</th><th>Login</th><th>Result</th></tr></thead>
                <tbody>
                  {result.results.map((r, i) => (
                    <tr key={`${r.email}-${i}`}>
                      <td>{r.name}</td>
                      <td>{r.employeeCode || '—'}</td>
                      <td>{r.email}</td>
                      <td>{r.delivered ? <span className="ok">Sent</span> : r.temporaryPassword ? <span className="mono">{r.temporaryPassword}</span> : <span className="warn">{r.error || 'Not sent'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {handOver.length > 0 && (
              <div className="login-details-actions">
                <button type="button" className="primary" onClick={() => downloadCsv(handOver)}><Icon name="Download" size={14} /> Download the {handOver.length} to hand over (CSV)</button>
                <small>Keep this file private and delete it after handing the passwords over.</small>
              </div>
            )}
          </>
        )}
        {bulk && result.skipped?.noEmail?.length > 0 && (
          <p className="login-details-skipped">Not included, no email in their profile: {result.skipped.noEmail.map((r) => r.name).join(', ')}. Add an email, then use 🔑 Send login details on their profile.</p>
        )}
        <footer><button type="button" className="primary" onClick={onClose}>Done</button></footer>
      </section>
    </div>
  );
}
