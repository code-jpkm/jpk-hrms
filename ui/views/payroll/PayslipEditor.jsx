import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, put, remove } from '../../api/client.js';
import { amountText, rupees, rupeesInWords, round2, whenText } from './payslipText.js';
import '../../styles/attendance.css';
import '../../styles/payslip.css';
import { payslipFileName } from '../../utils/payslipName.js';

/**
 * Edit one payslip directly, laid out like the printed slip: change any
 * amount, add earning / deduction lines (bonus, arrears, loan…), the work days
 * and LOP shown, and a note printed on the payslip. Works before and after
 * release. Lines that differ from the calculation are marked and can be put
 * back one by one, or all at once with "Back to calculated".
 */

let rowSeq = 0;
const nextId = () => `x${Date.now().toString(36)}${(rowSeq += 1)}`;
const asInput = (v) => (v === null || v === undefined ? '' : String(round2(v)));
const toNum = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));
const days = (v) => String(round2(v));

function stateFrom(data) {
  const p = data?.payslip;
  if (!p) return null;
  return {
    earnings: p.earnings.map((l) => ({ ...l, value: asInput(l.amount) })),
    deductions: p.deductions.map((l) => ({ ...l, value: asInput(l.amount) })),
    extra: [
      ...p.extraEarnings.map((l) => ({ id: l.id || nextId(), side: 'E', label: l.label, value: asInput(l.amount) })),
      ...p.extraDeductions.map((l) => ({ id: l.id || nextId(), side: 'D', label: l.label, value: asInput(l.amount) }))
    ],
    payableDays: asInput(p.info.payableDays),
    lopDays: asInput(p.info.lopDays),
    notes: p.notes || '',
    reason: ''
  };
}

function AmountInput({ value, onChange, label, calculated, edited, onReset, disabled }) {
  return (
    <span className={`ps-amount${edited ? ' is-edited' : ''}`}>
      <input type="number" inputMode="decimal" min="0" step="any" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={`${label} amount`} />
      {edited && !disabled && (
        <button type="button" className="ps-revert" onClick={onReset} title={`Back to the calculated ${amountText(calculated)}`} aria-label={`Put ${label} back to the calculated ${amountText(calculated)}`}>
          <Icon name="Undo2" size={12} /> {amountText(calculated)}
        </button>
      )}
    </span>
  );
}

export default function PayslipEditor({ slipId, canEdit = true, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setLoadError('');
    try {
      const res = await api(`/payroll/slips/${slipId}/payslip`, { toast: false });
      setData(res);
      setForm(stateFrom(res));
      setDirty(false);
    } catch (err) { setLoadError(err.message); }
  }
  useEffect(() => { load(); }, [slipId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (fn) => { setForm((f) => fn({ ...f })); setDirty(true); setDone(''); };
  const setLine = (group, ref, value) => change((f) => ({ ...f, [group]: f[group].map((l) => (l.ref === ref ? { ...l, value } : l)) }));
  const setExtra = (id, patch) => change((f) => ({ ...f, extra: f.extra.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const addExtra = (side) => change((f) => ({ ...f, extra: [...f.extra, { id: nextId(), side, label: '', value: '' }] }));
  const dropExtra = (id) => change((f) => ({ ...f, extra: f.extra.filter((l) => l.id !== id) }));

  const totals = useMemo(() => {
    if (!form) return null;
    const master = round2(form.earnings.reduce((t, l) => t + Number(l.master || 0), 0));
    const earnings = round2(form.earnings.reduce((t, l) => t + toNum(l.value), 0) + form.extra.filter((l) => l.side === 'E').reduce((t, l) => t + toNum(l.value), 0));
    const deductions = round2(form.deductions.reduce((t, l) => t + toNum(l.value), 0) + form.extra.filter((l) => l.side === 'D').reduce((t, l) => t + toNum(l.value), 0));
    return { master, earnings, deductions, net: round2(earnings - deductions) };
  }, [form]);

  const isEdited = (l) => Math.abs(toNum(l.value) - Number(l.calculated || 0)) >= 0.005;
  const anyEdited = data?.payslip?.edited;

  async function save(e) {
    e?.preventDefault();
    setBusy(true); setError(''); setDone('');
    try {
      const body = {
        lines: [...form.earnings, ...form.deductions].map((l) => ({ ref: l.ref, amount: toNum(l.value) })),
        extra: form.extra.map((l) => ({ id: l.id, side: l.side, label: l.label, amount: toNum(l.value) })),
        info: { payableDays: form.payableDays, lopDays: form.lopDays },
        notes: form.notes,
        reason: form.reason
      };
      const res = await put(`/payroll/slips/${slipId}/payslip`, body, { toast: false });
      setData(res);
      setForm(stateFrom(res));
      setDirty(false);
      setDone(res.message || 'Saved.');
      onSaved?.(res);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function resetAll() {
    if (!window.confirm('Put this payslip back to the calculated figures? Your changed amounts, added lines and the note are removed.')) return;
    setBusy(true); setError(''); setDone('');
    try {
      const res = await remove(`/payroll/slips/${slipId}/payslip`, { toast: false });
      setData(res);
      setForm(stateFrom(res));
      setDirty(false);
      setDone(res.message || 'Back to the calculated payslip.');
      onSaved?.(res);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function downloadPdf() {
    setError('');
    try {
      const blob = await api(`/payroll/slips/${slipId}/pdf`, { toast: false });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = payslipFileName(data?.employee, data?.month);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); }
  }

  const name = data?.employee ? `${data.employee.firstName || ''} ${data.employee.lastName || ''}`.trim() : '';
  const monthTitle = data?.month ? new Date(`${data.month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const extrasE = form?.extra.filter((l) => l.side === 'E') || [];
  const extrasD = form?.extra.filter((l) => l.side === 'D') || [];
  const info = data?.payslip?.info;

  return (
    <div className="att-drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="att-drawer ps-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Payslip of ${name}`}>
        <div className="att-drawer-head">
          <div>
            <small>{data?.employee ? `${name} · ${data.employee.employeeCode}` : 'Payslip'}</small>
            <h2>Payslip · {monthTitle}</h2>
          </div>
          <button type="button" className="att-close" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="att-drawer-body">
          {loadError && <div className="att-alert" role="alert"><Icon name="TriangleAlert" size={16} /><div>{loadError}</div></div>}
          {!form && !loadError && <div className="att-skeleton" style={{ minHeight: 320 }} />}

          {form && <>
            <div className="ps-chips">
              <span className={`ps-chip ${data.runStatus === 'FINALIZED' ? 'is-released' : ''}`}>{data.runStatus === 'FINALIZED' ? 'Released' : 'Draft'}</span>
              <span className={`ps-chip ${data.lastSharedAt ? 'is-sent' : ''}`}>{data.lastSharedAt ? `Sent ${whenText(data.lastSharedAt)}` : 'Not sent yet'}</span>
              {anyEdited && <span className="ps-chip is-edited">Edited{data.payslip.editedByName ? ` by ${data.payslip.editedByName}` : ''}{data.payslip.editedAt ? ` · ${whenText(data.payslip.editedAt)}` : ''}</span>}
            </div>

            {done && <div className="att-alert good" role="status"><Icon name="CircleCheck" size={16} /><div>{done}</div></div>}
            {data.changedSinceSent && !done && <div className="att-alert"><Icon name="Info" size={16} /><div>This payslip changed after it was sent. Send it again so {data.employee?.firstName || 'the employee'} gets the corrected one.</div></div>}

            <form className="ps-form" onSubmit={save}>
              <div className="ps-days">
                <label>Effective work days
                  <input type="number" min="0" max="31" step="0.5" value={form.payableDays} disabled={!canEdit} onChange={(e) => change((f) => ({ ...f, payableDays: e.target.value }))} />
                </label>
                <label>LOP days
                  <input type="number" min="0" max="31" step="0.5" value={form.lopDays} disabled={!canEdit} onChange={(e) => change((f) => ({ ...f, lopDays: e.target.value }))} />
                </label>
                <small>Calculated: {days(info.calculatedPayableDays)} days, {days(info.calculatedLopDays)} LOP{info.workingDays ? ` of ${days(info.workingDays)} working days` : ''}. These are what the payslip shows; amounts change only where you type them.</small>
              </div>

              <div className="ps-table">
                <section className="ps-side">
                  <div className="ps-head"><span>Earnings</span><span>Master</span><span>Amount</span></div>
                  {form.earnings.map((l) => (
                    <div className="ps-row" key={l.ref}>
                      <span className="ps-label">{l.label}</span>
                      <span className="ps-master">{amountText(l.master)}</span>
                      <AmountInput value={l.value} label={l.label} calculated={l.calculated} edited={isEdited(l)} disabled={!canEdit} onChange={(v) => setLine('earnings', l.ref, v)} onReset={() => setLine('earnings', l.ref, asInput(l.calculated))} />
                    </div>
                  ))}
                  {extrasE.map((l) => (
                    <div className="ps-row is-extra" key={l.id}>
                      <input className="ps-label-input" value={l.label} placeholder="e.g. BONUS" maxLength={40} onChange={(e) => setExtra(l.id, { label: e.target.value })} aria-label="Earning name" />
                      <span className="ps-master" />
                      <span className="ps-amount"><input type="number" inputMode="decimal" min="0" step="any" value={l.value} onChange={(e) => setExtra(l.id, { value: e.target.value })} aria-label={`${l.label || 'New earning'} amount`} /><button type="button" className="ps-drop" onClick={() => dropExtra(l.id)} aria-label={`Remove ${l.label || 'this line'}`}><Icon name="X" size={13} /></button></span>
                    </div>
                  ))}
                  {canEdit && <button type="button" className="ps-add" onClick={() => addExtra('E')}><Icon name="Plus" size={14} /> Add earning (bonus, arrears…)</button>}
                  <div className="ps-row ps-total"><span>Total Earnings</span><span className="ps-master">{amountText(totals.master)}</span><b>{amountText(totals.earnings)}</b></div>
                </section>

                <section className="ps-side">
                  <div className="ps-head ps-head-d"><span>Deductions</span><span>Amount</span></div>
                  {form.deductions.map((l) => (
                    <div className="ps-row ps-row-d" key={l.ref}>
                      <span className="ps-label">{l.label}</span>
                      <AmountInput value={l.value} label={l.label} calculated={l.calculated} edited={isEdited(l)} disabled={!canEdit} onChange={(v) => setLine('deductions', l.ref, v)} onReset={() => setLine('deductions', l.ref, asInput(l.calculated))} />
                    </div>
                  ))}
                  {extrasD.map((l) => (
                    <div className="ps-row ps-row-d is-extra" key={l.id}>
                      <input className="ps-label-input" value={l.label} placeholder="e.g. ADVANCE" maxLength={40} onChange={(e) => setExtra(l.id, { label: e.target.value })} aria-label="Deduction name" />
                      <span className="ps-amount"><input type="number" inputMode="decimal" min="0" step="any" value={l.value} onChange={(e) => setExtra(l.id, { value: e.target.value })} aria-label={`${l.label || 'New deduction'} amount`} /><button type="button" className="ps-drop" onClick={() => dropExtra(l.id)} aria-label={`Remove ${l.label || 'this line'}`}><Icon name="X" size={13} /></button></span>
                    </div>
                  ))}
                  {canEdit && <button type="button" className="ps-add" onClick={() => addExtra('D')}><Icon name="Plus" size={14} /> Add deduction (advance, fine…)</button>}
                  <div className="ps-row ps-row-d ps-total"><span>Total Deductions</span><b>{amountText(totals.deductions)}</b></div>
                </section>
              </div>

              <div className="ps-net">
                <div><span>Net Pay for the Month</span><b>{rupees(totals.net)}</b></div>
                <small>({rupeesInWords(totals.net)})</small>
                {Math.abs(totals.net - Number(data.payslip.calculatedNet || 0)) >= 0.005 && <small className="ps-calc-net">Calculated net pay: {rupees(data.payslip.calculatedNet)}</small>}
              </div>

              <label className="ps-field"><span>Note printed on the payslip</span>
                <textarea value={form.notes} maxLength={600} disabled={!canEdit} placeholder="e.g. Diwali bonus paid with this salary. Loan instalment 1 of 6." onChange={(e) => change((f) => ({ ...f, notes: e.target.value }))} />
              </label>
              {canEdit && <label className="ps-field"><span>Why are you changing it? <i>(optional, kept in the history)</i></span>
                <input value={form.reason} maxLength={300} placeholder="e.g. Approved by MD on 20 Nov" onChange={(e) => change((f) => ({ ...f, reason: e.target.value }))} />
              </label>}

              {error && <div className="att-alert" role="alert"><Icon name="TriangleAlert" size={16} /><div>{error}</div></div>}

              <div className="att-action-row ps-actions">
                {canEdit && <button className="att-btn" disabled={busy || !dirty}><Icon name="Save" size={16} /> {busy ? 'Saving…' : 'Save payslip'}</button>}
                <button type="button" className="att-btn secondary" onClick={downloadPdf} disabled={dirty} title={dirty ? 'Save first to get the PDF with your changes' : ''}><Icon name="Download" size={16} /> Download PDF</button>
                {canEdit && anyEdited && <button type="button" className="att-btn secondary" onClick={resetAll} disabled={busy}><Icon name="RotateCcw" size={16} /> Back to calculated</button>}
              </div>
              {dirty && <small className="ps-unsaved">Unsaved changes.</small>}
              <small className="ps-hint">Saving does not notify anyone. The employee gets the payslip when you send it.</small>
            </form>
          </>}
        </div>
      </aside>
    </div>
  );
}
