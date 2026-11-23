import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Empty, ErrorBox, Field } from '../../components/Ui.jsx';
import ImportResult from '../../components/ImportResult.jsx';
import { api, post } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

const money = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const monthName = (m) => {
  if (!/^\d{4}-\d{2}$/.test(m || '')) return '';
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const person = (loan) => `${loan.employeeId?.firstName || ''} ${loan.employeeId?.lastName || ''}`.trim();
const blankLoan = (month) => ({ employeeId: '', name: 'Loan', amount: '', emi: '', balanceAtStart: '', startMonth: month, notes: '' });

/**
 * Loans and salary advances. The EMI comes off the payslip (LOAN line) every
 * month until the balance is recovered; what is recovered is read from the
 * payslips, so a LOAN line HR changes on a payslip moves the balance with it.
 */
export default function Loans({ employees = [], canEdit, onChanged }) {
  const { data, error: loadError, reload } = useApi('/payroll/loans', []);
  const loans = data?.loans || [];
  const month = data?.month || '';
  const [form, setForm] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const running = loans.filter((l) => l.state === 'ACTIVE');
  const shown = showDone ? loans : running;
  const draftNote = (months = []) => (months.length ? ` Draft payslip updated (${months.map(monthName).join(', ')}).` : '');

  function changed() { reload(); onChanged?.(); }

  async function save(e) {
    e.preventDefault(); setError(null);
    try {
      const res = await post('/payroll/loans', form);
      toast.success(`Loan saved.${draftNote(res.draftsUpdated)}`);
      setForm(null); changed();
    } catch (err) { setError(err); }
  }

  async function close(loan, reopen = false) {
    const reason = reopen ? '' : window.prompt(`Close "${loan.name}" of ${person(loan)}? No instalment from ${monthName(month)} on. Reason:`, 'Paid back');
    if (!reopen && reason === null) return;
    setError(null);
    try {
      const res = await post(`/payroll/loans/${loan._id}/close`, reopen ? { reopen: true } : { reason });
      toast.success(`${reopen ? 'Loan opened again.' : 'Loan closed.'}${draftNote(res.draftsUpdated)}`);
      changed();
    } catch (err) { setError(err); }
  }

  async function downloadTemplate() {
    try {
      const blob = await api('/payroll/loans/template.xlsx');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'JPK-Loans-Import-Template.xlsx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { toast.error(err.message || 'Could not download the template'); }
  }

  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setResult(null); setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await post('/payroll/loans/import-excel', { fileName: file.name, dataUrl });
      setResult({ fileName: file.name, ...res });
      changed();
    } catch (err) { setError(err); } finally { e.target.value = ''; }
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return <div className="loans-panel">
    <div className="loans-summary">
      <div><span>Running loans</span><b>{running.length}</b></div>
      <div><span>EMIs each month</span><b>{money(running.reduce((t, l) => t + Number(l.emi || 0), 0))}</b></div>
      <div><span>Still to recover</span><b>{money(running.reduce((t, l) => t + Number(l.left || 0), 0))}</b></div>
    </div>
    <ErrorBox error={loadError || error} />
    {canEdit && <div className="salary-editor-actions">
      <button type="button" className={form ? '' : 'primary'} onClick={() => setForm(form ? null : blankLoan(month))}>{form ? 'Cancel' : 'Add a loan'}</button>
      <button type="button" onClick={downloadTemplate}>Download Excel template</button>
      <label className="file-button">Upload loans Excel<input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={upload} /></label>
    </div>}
    {form && <form className="form-grid loans-form" onSubmit={save}>
      {!form._id && <Field label="Employee"><select required value={form.employeeId} onChange={set('employeeId')}><option value="">Select employee</option>{employees.map((emp) => <option key={emp._id} value={emp._id}>{emp.employeeCode} · {emp.firstName} {emp.lastName || ''}</option>)}</select></Field>}
      <Field label="Loan name"><input value={form.name} maxLength={60} onChange={set('name')} /></Field>
      <Field label="Loan amount (₹)"><input type="number" min="1" step="any" required value={form.amount} onChange={set('amount')} /></Field>
      <Field label="Monthly EMI (₹)"><input type="number" min="1" step="any" required value={form.emi} onChange={set('emi')} /></Field>
      <Field label="Still to recover (₹)" hint="From the first EMI month. Blank: the whole loan amount."><input type="number" min="0" step="any" value={form.balanceAtStart} onChange={set('balanceAtStart')} /></Field>
      <Field label="First EMI month"><input type="month" required value={form.startMonth} onChange={set('startMonth')} /></Field>
      <Field label="Note"><input value={form.notes} maxLength={300} onChange={set('notes')} /></Field>
      <div className="loans-form-actions"><button className="primary" type="submit">{form._id ? 'Save changes' : 'Save loan'}</button></div>
    </form>}
    {result && <ImportResult
      title={`Loans · ${result.fileName}`}
      facts={[`${result.created || 0} added`, `${result.updated || 0} updated`, result.draftsUpdated?.length ? `draft payslips updated (${result.draftsUpdated.map(monthName).join(', ')})` : null]}
      errors={result.errors || []}
      warnings={result.warnings || []}
      onClose={() => setResult(null)} />}
    {!shown.length ? <Empty>{loans.length ? 'No running loans.' : 'No loans yet.'}</Empty> : <div className="loans-table-wrap"><table className="loans-table">
      <thead><tr><th>Employee</th><th>Loan</th><th>EMI</th><th>Recovered</th><th>Left</th><th>EMIs left</th><th>From</th><th /></tr></thead>
      <tbody>{shown.map((l) => <tr key={l._id} className={l.state === 'ACTIVE' ? '' : 'done'}>
        <td><b>{l.employeeId?.employeeCode}</b><small>{person(l)}</small></td>
        <td>{l.name}<small>{money(l.amount)}{l.source === 'GREYTHR' ? ' · from greytHR' : ''}</small></td>
        <td>{money(l.emi)}</td>
        <td>{money(l.recovered)}</td>
        <td><b>{money(l.left)}</b></td>
        <td>{l.state === 'ACTIVE' ? l.instalmentsLeft : l.state === 'RECOVERED' ? 'Recovered' : 'Closed'}</td>
        <td>{monthName(l.startMonth)}</td>
        <td>{canEdit && <div className="loans-row-actions">
          {l.state === 'ACTIVE' && <button type="button" onClick={() => setForm({ _id: l._id, name: l.name, amount: l.amount, emi: l.emi, balanceAtStart: l.balanceAtStart, startMonth: l.startMonth, notes: l.notes || '' })}>Edit</button>}
          {l.state === 'ACTIVE' && <button type="button" onClick={() => close(l)}>Close</button>}
          {l.state === 'CLOSED' && <button type="button" onClick={() => close(l, true)}>Open again</button>}
        </div>}</td>
      </tr>)}</tbody>
    </table></div>}
    {loans.length > running.length && <button type="button" className="loans-toggle" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide recovered and closed loans' : `Show recovered and closed loans (${loans.length - running.length})`}</button>}
    <p className="loans-help">The EMI comes off the payslip as the LOAN line every month, after PF, ESI and P.Tax, until the balance is recovered; the last instalment is only what is left. To skip or change one month, edit the LOAN line on that payslip: the balance follows the payslips.</p>
  </div>;
}
