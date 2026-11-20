import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { post } from '../../api/client.js';
import { whenText } from './payslipText.js';
import '../../styles/attendance.css';
import '../../styles/payslip.css';

/**
 * Send payslips for one month. Everyone who has not received this month's
 * payslip is ticked; untick anyone who should not get it. People who already
 * got it are not listed (show them only to send again, e.g. after a correction).
 */
export default function SendPayslips({ month, slips = [], onClose, onSent }) {
  const unsent = useMemo(() => slips.filter((s) => !s.lastSharedAt), [slips]);
  const sent = useMemo(() => slips.filter((s) => s.lastSharedAt), [slips]);
  const [selected, setSelected] = useState(() => new Set(unsent.map((s) => s._id)));
  const [showSent, setShowSent] = useState(false);
  const [query, setQuery] = useState('');
  const [channels, setChannels] = useState({ email: true, whatsapp: true });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  // After a reload: slips that are new to this dialog start ticked; anyone just
  // sent drops out; people you unticked stay unticked.
  const seen = useRef(new Set(slips.map((s) => s._id)));
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => unsent.some((s) => s._id === id) || sent.some((s) => s._id === id)));
      for (const s of unsent) if (!seen.current.has(s._id)) next.add(s._id);
      for (const s of slips) seen.current.add(s._id);
      return next;
    });
  }, [slips]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = (s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const e = s.employeeId || {};
    return `${e.firstName || ''} ${e.lastName || ''} ${e.employeeCode || ''} ${e.department || ''}`.toLowerCase().includes(q);
  };
  const shownUnsent = unsent.filter(matches);
  const shownSent = showSent ? sent.filter(matches) : [];
  const toggle = (id) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const setMany = (list, on) => setSelected((prev) => { const next = new Set(prev); list.forEach((s) => (on ? next.add(s._id) : next.delete(s._id))); return next; });
  const count = selected.size;
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  async function send() {
    if (!count) return;
    if (!channels.email && !channels.whatsapp) { setError('Choose email, WhatsApp or both.'); return; }
    setBusy(true); setError(''); setResult('');
    try {
      const res = await post('/payroll/slips/share', { salarySlipIds: [...selected], month, channels, message }, { toast: false });
      setResult(`Sent to ${res.shared} ${res.shared === 1 ? 'person' : 'people'}. Delivery status is in Integrations → Delivery log.`);
      setSelected(new Set());
      onSent?.(res);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  // A render helper, not a component, so ticking a box never remounts the list.
  function renderRow(s, isSent) {
    const e = s.employeeId || {};
    const noEmail = channels.email && !e.email;
    const noPhone = channels.whatsapp && !e.phone;
    const changed = isSent && s.contentChangedAt && new Date(s.contentChangedAt) > new Date(s.lastSharedAt);
    return (
      <label key={s._id} className={`ps-send-row${selected.has(s._id) ? ' is-on' : ''}`}>
        <input type="checkbox" checked={selected.has(s._id)} onChange={() => toggle(s._id)} />
        <span className="ps-send-who">
          <b>{`${e.firstName || ''} ${e.lastName || ''}`.trim() || 'Employee'}</b>
          <small>{e.employeeCode}{e.department ? ` · ${e.department}` : ''}{isSent ? ` · sent ${whenText(s.lastSharedAt)}` : ''}</small>
        </span>
        <span className="ps-send-flags">
          {changed && <em className="ps-flag warn">changed since sent</em>}
          {s.edits && <em className="ps-flag">edited</em>}
          {noEmail && <em className="ps-flag bad" title="No email address on the employee profile">no email</em>}
          {noPhone && <em className="ps-flag bad" title="No phone number on the employee profile">no phone</em>}
        </span>
      </label>
    );
  }

  return (
    <div className="att-drawer-backdrop ps-modal-backdrop" onClick={onClose} role="presentation">
      <div className="ps-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Send payslips for ${label}`}>
        <div className="ps-modal-head">
          <div><small>SEND PAYSLIPS</small><h2>{label}</h2></div>
          <button type="button" className="att-close" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="ps-modal-body">
          <div className="ps-send-options">
            <label className="ps-toggle"><input type="checkbox" checked={channels.email} onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))} /> Email with the PDF</label>
            <label className="ps-toggle"><input type="checkbox" checked={channels.whatsapp} onChange={(e) => setChannels((c) => ({ ...c, whatsapp: e.target.checked }))} /> WhatsApp link</label>
          </div>
          <input className="ps-search" placeholder="Search name, code or department" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />

          <div className="ps-send-bar">
            <span><b>{unsent.length}</b> not sent yet{sent.length ? ` · ${sent.length} already sent` : ''}</span>
            {shownUnsent.length > 0 && <span className="ps-send-bulk">
              <button type="button" onClick={() => setMany(shownUnsent, true)}>Tick all</button>
              <button type="button" onClick={() => setMany(shownUnsent, false)}>Untick all</button>
            </span>}
          </div>

          <div className="ps-send-list" role="group" aria-label="People to send to">
            {shownUnsent.map((s) => renderRow(s, false))}
            {!unsent.length && <p className="ps-empty">Everyone has received this month's payslip.</p>}
            {unsent.length > 0 && !shownUnsent.length && <p className="ps-empty">No match.</p>}
          </div>

          {sent.length > 0 && (
            <div className="ps-sent-block">
              <button type="button" className="ps-link" onClick={() => setShowSent((v) => !v)} aria-expanded={showSent}>
                <Icon name={showSent ? 'ChevronUp' : 'ChevronDown'} size={14} /> {showSent ? 'Hide' : 'Show'} the {sent.length} already sent (only to send again)
              </button>
              {showSent && <div className="ps-send-list is-sent">{shownSent.map((s) => renderRow(s, true))}</div>}
            </div>
          )}

          <label className="ps-field"><span>Message with the payslip <i>(optional)</i></span>
            <textarea value={message} maxLength={500} placeholder="e.g. Salary credited on 1 Dec." onChange={(e) => setMessage(e.target.value)} />
          </label>
          {error && <div className="att-alert" role="alert"><Icon name="TriangleAlert" size={16} /><div>{error}</div></div>}
          {result && <div className="att-alert good" role="status"><Icon name="CircleCheck" size={16} /><div>{result}</div></div>}
        </div>

        <div className="ps-modal-foot">
          <button type="button" className="att-btn secondary" onClick={onClose}>Close</button>
          <button type="button" className="att-btn" onClick={send} disabled={busy || !count}><Icon name="SendHorizontal" size={16} /> {busy ? 'Sending…' : `Send to ${count} ${count === 1 ? 'person' : 'people'}`}</button>
        </div>
      </div>
    </div>
  );
}
