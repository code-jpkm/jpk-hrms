import React, { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, post } from '../../api/client.js';
import { currentMonthKey } from '../../utils/time.js';
import '../../styles/v26.css';

/**
 * Issue a letter from a live Document Studio template: download it, or file it
 * in the employee's documents and send it by email (PDF attached) / WhatsApp.
 */
export default function IssueLetter({ employeeId, employeeName, onIssued }) {
  const [templates, setTemplates] = useState(null);
  const [type, setType] = useState('');
  const [month, setMonth] = useState(currentMonthKey());
  const [channels, setChannels] = useState({ email: true, whatsapp: false });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api('/document-templates', { toast: false })
      .then((r) => {
        if (!alive) return;
        const live = (r.templates || []).filter((t) => t.active);
        const unique = [...new Map(live.map((t) => [t.type, t])).values()];
        setTemplates(unique);
        setType((cur) => cur || unique.find((t) => t.type !== 'PAYSLIP')?.type || unique[0]?.type || '');
      })
      .catch(() => { if (alive) setTemplates([]); });
    return () => { alive = false; };
  }, []);

  const label = (t) => (t.name || t.type.replaceAll('_', ' '));
  const body = () => ({ type, employeeId, ...(type === 'PAYSLIP' ? { month } : {}) });

  async function download() {
    setBusy('download'); setError('');
    try {
      const blob = await api('/document-templates/issue', { method: 'POST', body: JSON.stringify(body()), toast: false });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${type.toLowerCase()}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  async function send() {
    if (!channels.email && !channels.whatsapp && !window.confirm('No channel selected. File the letter in their documents without sending it?')) return;
    setBusy('send'); setError('');
    try {
      await post('/document-templates/issue/send', { ...body(), channels }, { loadingMessage: 'Preparing the letter…', successMessage: `Letter issued to ${employeeName || 'the employee'}` });
      onIssued?.();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  if (templates === null) return null;
  if (!templates.length) {
    return (
      <div className="v26-note" style={{ marginBottom: 12 }}>
        <Icon name="FileText" size={16} />
        <div>No live letter templates yet. Design one in <b>Document Studio</b> and mark it live to issue offer, confirmation or experience letters from here.</div>
      </div>
    );
  }
  return (
    <div className="issue-letter">
      <div className="issue-letter-head">
        <span className="dash-today-icon teal"><Icon name="FileCheck2" size={16} /></span>
        <div><b>Issue a letter</b><small>Uses the live template from Document Studio, filled with this employee's details.</small></div>
      </div>
      <div className="issue-letter-row">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Letter type">
          {templates.map((t) => <option key={t.type} value={t.type}>{label(t)}</option>)}
        </select>
        {type === 'PAYSLIP' && <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Payslip month" />}
        <label className="issue-check"><input type="checkbox" checked={channels.email} onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))} /> Email PDF</label>
        <label className="issue-check"><input type="checkbox" checked={channels.whatsapp} onChange={(e) => setChannels((c) => ({ ...c, whatsapp: e.target.checked }))} /> WhatsApp</label>
        <button type="button" className="v26-btn secondary" style={{ height: 38 }} onClick={download} disabled={!type || Boolean(busy)}><Icon name="Download" size={14} /> {busy === 'download' ? 'Preparing…' : 'Download'}</button>
        <button type="button" className="v26-btn" style={{ height: 38 }} onClick={send} disabled={!type || Boolean(busy)}><Icon name="Send" size={14} /> {busy === 'send' ? 'Sending…' : 'Issue & send'}</button>
      </div>
      {error && <p className="ai-error" style={{ margin: 0 }}><Icon name="TriangleAlert" size={13} /> {error}</p>}
    </div>
  );
}
