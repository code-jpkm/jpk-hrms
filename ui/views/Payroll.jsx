import { currentMonthKey, monthLabel } from '../utils/time.js';
import { PayrollReview, ExplainSlip } from './payroll/PayrollAi.jsx';
import '../styles/attendance.css';
import '../styles/v26.css';
import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, Empty, ErrorBox, Field, Table } from '../components/Ui.jsx';
import { api, post, remove } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';

const defaultTemplate = {
  name: 'Custom Payslip Format',
  companyName: '',
  companyAddress: '',
  headerText: '',
  footerText: 'Computer generated payslip.',
  primaryColor: '#1F3445',
  showBankLast4: true,
  showPfEsiNumbers: true,
  showAttendanceSummary: true,
  earningsLabels: [{ key: 'basic', label: 'Basic' }, { key: 'hra', label: 'HRA' }, { key: 'conveyance', label: 'Conv.' }, { key: 'specialAllowance', label: 'Spl Allowance' }, { key: 'proratedGross', label: 'Gross Payable' }],
  deductionLabels: [{ key: 'pf', label: 'PF' }, { key: 'esi', label: 'ESI' }, { key: 'ptax', label: 'Professional Tax' }, { key: 'total', label: 'Total Deductions' }],
  customLines: []
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
}

function pct(value, fallback=0) { const n=Number(value ?? fallback); return n > 1 ? n/100 : n; }

export default function Payroll() {
  const { user } = useAuth();
  const canReadPayrollAdmin = hasAbility(user, 'PAYROLL', 'READ');
  const canRunPayroll = hasAbility(user, 'PAYROLL', 'RUN');
  const canUpdateRules = hasAbility(user, 'PAYROLL', 'UPDATE_RULES');
  const canUpdateTemplate = hasAbility(user, 'PAYROLL', 'UPDATE_TEMPLATE');
  const canSharePayslips = hasAbility(user, 'PAYROLL', 'SHARE');
  const canAdjustPayslips = hasAbility(user, 'PAYROLL', 'ADJUST');
  const canUpdateSalaryMaster = hasAbility(user, 'PAYROLL', 'UPDATE_SALARY_MASTER');
  const [month, setMonth] = useState(currentMonthKey());
  const { data: runs, error: runsError, reload: reloadRuns } = useApi(canReadPayrollAdmin ? '/payroll/runs' : '', [canReadPayrollAdmin]);
  const { data: slips, error: slipsError, reload: reloadSlips } = useApi(`/payroll/slips?month=${month}`, [month]);
  const { data: templateData, error: templateError, reload: reloadTemplate } = useApi(canReadPayrollAdmin ? '/payroll/payslip-template' : '', [canReadPayrollAdmin]);
  const { data: rulesData, error: rulesError, reload: reloadRules } = useApi(canReadPayrollAdmin ? '/payroll/rules' : '', [canReadPayrollAdmin]);
  const { data: employeesData, error: employeesError } = useApi(canReadPayrollAdmin ? '/payroll/employees' : '', [canReadPayrollAdmin]);
  const { data: salaryMastersData, error: salaryMastersError, reload: reloadSalaryMasters } = useApi(canReadPayrollAdmin ? `/payroll/salary-masters?activeAt=${month}` : '', [month, canReadPayrollAdmin]);
  const [payRule, setPayRule] = useState({ name: 'Default Payroll Rule', pf: { enabled: true, employeePercent: 0.12, employerPercent: 0.12, wageCap: 15000, calculationBase: 'BASIC', applyWageCap: true }, esi: { enabled: true, employeePercent: 0.0075, employerPercent: 0.0325, grossCap: 21000, calculationBase: 'GROSS' }, ptax: { enabled: true, defaultAmount: 200, slabs: [] }, customEarnings: [], customDeductions: [], notes: '' });
  const [template, setTemplate] = useState(defaultTemplate);
  const [selected, setSelected] = useState([]);
  const [share, setShare] = useState({ email: true, whatsapp: true, message: '' });
  const [salaryMaster, setSalaryMaster] = useState({ employeeId: '', effectiveMonth: currentMonthKey(), earnings: { basic: 0, hra: 0, conveyance: 0, specialAllowance: 0, otherEarnings: 0 }, deductions: { pf: 0, esi: 0, ptax: 0, otherDeductions: 0 }, calculationMode: 'RULE_BASED_DEDUCTIONS', notes: '' });
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [releasedMonth, setReleasedMonth] = useState('');
  const [revealedMasters, setRevealedMasters] = useState([]);
  const [revealedSlips, setRevealedSlips] = useState([]);

  useEffect(() => {
    if (templateData?.template) setTemplate({ ...defaultTemplate, ...templateData.template });
  }, [templateData]);

  useEffect(() => {
    if (rulesData?.rules?.[0]) setPayRule((r) => ({ ...r, ...rulesData.rules[0] }));
  }, [rulesData]);

  const employees = employeesData?.employees || [];
  const salaryMasters = salaryMastersData?.salaryMasters || [];
  const salaryGross = Number(salaryMaster.earnings.basic || 0) + Number(salaryMaster.earnings.hra || 0) + Number(salaryMaster.earnings.conveyance || 0) + Number(salaryMaster.earnings.specialAllowance || 0) + Number(salaryMaster.earnings.otherEarnings || 0);
  const salaryDeductions = Number(salaryMaster.deductions.pf || 0) + Number(salaryMaster.deductions.esi || 0) + Number(salaryMaster.deductions.ptax || 0) + Number(salaryMaster.deductions.otherDeductions || 0);
  const salaryNet = salaryGross - salaryDeductions;
  const salaryEmployee = employees.find((e) => e._id === salaryMaster.employeeId);
  const autoPfBase = payRule.pf?.calculationBase === 'GROSS' ? salaryGross : Number(salaryMaster.earnings.basic || 0);
  const autoPfCapped = payRule.pf?.applyWageCap === false ? autoPfBase : Math.min(autoPfBase, Number(payRule.pf?.wageCap || autoPfBase));
  const autoPf = payRule.pf?.enabled === false || salaryEmployee?.statutory?.pfApplicable === false ? 0 : Math.round(autoPfCapped * pct(payRule.pf?.employeePercent, .12) * 100) / 100;
  const autoEsiBase = payRule.esi?.calculationBase === 'BASIC' ? Number(salaryMaster.earnings.basic || 0) : salaryGross;
  const autoEsi = payRule.esi?.enabled === false || salaryEmployee?.statutory?.esiApplicable === false || (payRule.esi?.grossCap && salaryGross > Number(payRule.esi.grossCap)) ? 0 : Math.round(autoEsiBase * pct(payRule.esi?.employeePercent, .0075) * 100) / 100;
  const autoPtax = payRule.ptax?.enabled === false || salaryEmployee?.statutory?.ptaxApplicable === false ? 0 : Number((payRule.ptax?.slabs || []).find((x)=>salaryGross >= Number(x.from||0) && salaryGross <= Number(x.to||Number.MAX_SAFE_INTEGER))?.amount ?? payRule.ptax?.defaultAmount ?? 0);
  const autoNet = salaryGross - autoPf - autoEsi - autoPtax - Number(salaryMaster.deductions.otherDeductions || 0);
  const currentRun = useMemo(() => (runs?.runs || []).find((r) => r.month === month), [runs, month]);
  const finalizedRuns = useMemo(() => (runs?.runs || []).filter((r) => r.status === 'FINALIZED'), [runs]);
  const releasedRun = useMemo(() => finalizedRuns.find((r) => r.month === releasedMonth), [finalizedRuns, releasedMonth]);
  const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const toggleRevealMaster = (id) => setRevealedMasters((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const toggleRevealSlip = (id) => setRevealedSlips((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  function setSalaryValue(group, key, value) {
    setSalaryMaster((s) => ({ ...s, [group]: { ...(s[group] || {}), [key]: Number(value || 0) } }));
  }

  function editSalaryMaster(master) {
    setSalaryMaster({
      employeeId: master.employeeId?._id || master.employeeId,
      effectiveMonth: master.effectiveMonth,
      earnings: { basic: master.earnings?.basic || 0, hra: master.earnings?.hra || 0, conveyance: master.earnings?.conveyance || 0, specialAllowance: master.earnings?.specialAllowance || 0, otherEarnings: master.earnings?.otherEarnings || 0 },
      deductions: { pf: master.deductions?.pf || 0, esi: master.deductions?.esi || 0, ptax: master.deductions?.ptax || 0, otherDeductions: master.deductions?.otherDeductions || 0 },
      calculationMode: master.calculationMode || 'RULE_BASED_DEDUCTIONS',
      notes: master.notes || ''
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveSalaryMaster() {
    setError(null); setMessage('');
    try {
      await post('/payroll/salary-masters', salaryMaster);
      setMessage('Salary master saved. New payroll generation will use this component-wise salary.');
      reloadSalaryMasters();
    } catch (err) { setError(err); }
  }

  async function deleteSalaryMaster(id) {
    if (!window.confirm('Delete this salary master?')) return;
    setError(null); setMessage('');
    try { await remove(`/payroll/salary-masters/${id}`); setMessage('Salary master deleted.'); reloadSalaryMasters(); } catch (err) { setError(err); }
  }

  async function downloadSalaryTemplate() {
    setError(null);
    try { const blob=await api('/payroll/salary-masters/template.xlsx'); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='JPK-Salary-Master-Import-Template.xlsx'; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); toast.success('Salary master Excel template download started'); } catch(err){ setError(err); toast.error(err.message || 'Could not download salary template'); }
  }
  async function importSalaryExcel(e) {
    const file=e.target.files?.[0]; if(!file) return;
    setError(null); setMessage('');
    try { const dataUrl=await fileToDataUrl(file); const res=await post('/payroll/salary-masters/import-excel',{fileName:file.name,dataUrl}); setMessage(`Salary Excel import complete: ${res.saved || 0} saved${res.errors ? `, ${res.errors} error(s)` : ''}. PF, ESI and P.Tax were calculated automatically.`); reloadSalaryMasters(); }
    catch(err){ setError(err); } finally { e.target.value=''; }
  }

  async function runPayroll() {
    setError(null); setMessage('');
    try { await post('/payroll/run', { month }); setMessage('Salary sheet regenerated.'); reloadRuns(); reloadSlips(); }
    catch (err) {
      // A released month can only be regenerated by Super Admin with a reason.
      if (err.status === 409 && user?.role === 'SUPER_ADMIN') {
        const reason = window.prompt(`${err.message}\n\nType a reason to regenerate the RELEASED payroll for ${month} (slips employees already received will change):`);
        if (!reason) return;
        try { await post('/payroll/run', { month, force: true, reason }); setMessage('Released payroll regenerated and moved back to draft.'); reloadRuns(); reloadSlips(); } catch (e2) { setError(e2); }
        return;
      }
      setError(err);
    }
  }

  async function releasePayroll() {
    if (!currentRun?._id) return;
    if (!window.confirm(`Release payroll for ${currentRun.month}? Employees will be notified.`)) return;
    setError(null); setMessage('');
    try {
      await post(`/payroll/runs/${currentRun._id}/release`, { reason: `Payroll ${currentRun.month} approved for release` }, { loadingMessage: `Releasing ${currentRun.month} payroll…`, successMessage: `Payroll ${currentRun.month} released` });
      setReleasedMonth(currentRun.month);
      reloadRuns(); reloadSlips();
    } catch (err) { setError(err); }
  }

  async function downloadPdf(id) {
    setError(null);
    try {
      const blob = await api(`/payroll/slips/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `salary-slip-${month}.pdf`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
      toast.success('Salary slip PDF download started');
    } catch (err) {
      setError(err);
      toast.error(err.message || 'Could not download salary slip');
    }
  }

  async function downloadSalarySheet(runId, runMonth, format) {
    setError(null); setMessage('');
    try {
      const blob = await api(`/payroll/runs/${runId}/salary-sheet.${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `salary-sheet-${runMonth}.${format}`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
      toast.success(`Salary sheet ${String(format).toUpperCase()} download started`);
    } catch (err) { setError(err); toast.error(err.message || 'Could not download salary sheet'); }
  }


  function toggleSelected(id) {
    setSelected((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function shareSelected() {
    setError(null); setMessage('');
    try {
      const body = { salarySlipIds: selected, month, channels: { email: share.email, whatsapp: share.whatsapp }, message: share.message };
      let res;
      try { res = await post('/payroll/slips/share', body); }
      catch (err) {
        if (err.status !== 409) throw err;
        if (!window.confirm(`${err.message}\n\nShare the draft slips anyway? Employees will see them in email/WhatsApp before payroll is released.`)) return;
        res = await post('/payroll/slips/share', { ...body, allowDraft: true });
      }
      setMessage(`Payslips shared for ${res.shared} employee(s). Delivery status: Integrations → Delivery log.`);
      setSelected([]);
      reloadSlips();
    } catch (err) { setError(err); }
  }

  async function saveTemplate() {
    setError(null); setMessage('');
    try {
      await post('/payroll/payslip-template', template);
      setMessage('Payslip PDF format saved. Download/share will use the new format.');
      reloadTemplate();
    } catch (err) { setError(err); }
  }

  function setTemplateValue(key, value) { setTemplate((t) => ({ ...t, [key]: value })); }
  function setRule(path, value) {
    setPayRule((rule) => {
      const copy = { ...rule, pf: { ...(rule.pf || {}) }, esi: { ...(rule.esi || {}) }, ptax: { ...(rule.ptax || {}) } };
      const [a, b] = path.split('.');
      if (b) copy[a][b] = value;
      else copy[a] = value;
      return copy;
    });
  }
  async function savePayRule() {
    setError(null); setMessage('');
    try { await post('/payroll/rules', payRule); setMessage('PF/ESI/PTax/payroll rule saved.'); reloadRules(); } catch (err) { setError(err); }
  }
  async function adjustSlip(id) {
    const reason = window.prompt('Reason for manual salary adjustment / special override?');
    if (!reason) return;
    const earningsAdjustment = Number(window.prompt('Extra earning amount? Use 0 if none.', '0') || 0);
    const deductionAdjustment = Number(window.prompt('Extra deduction amount? Use 0 if none.', '0') || 0);
    setError(null); setMessage('');
    try { await post(`/payroll/slips/${id}/adjust`, { earningsAdjustment, deductionAdjustment, reason }); setMessage('Salary slip adjusted.'); reloadSlips(); } catch (err) { setError(err); }
  }

  return (
    <div className="nexus-page payroll-v24">
      <section className="directory-hero premium-hero page-intro"><div><small>COMPENSATION & COMPLIANCE</small><h1>{canReadPayrollAdmin ? 'Payroll Command Center' : 'My Payroll'}</h1><p>{canReadPayrollAdmin ? 'Generate the monthly salary sheet, check it, release payslips and send them to employees. Salary figures stay hidden until you click the eye.' : 'Your payslips, month by month. Download any month as a PDF.'}</p></div></section>
      <ErrorBox error={error || runsError || slipsError || templateError || rulesError || employeesError || salaryMastersError} />

      <div className="payroll-top-grid">
        <section className="premium-section-card payroll-run-card"><div className="premium-section-head"><div><small>CURRENT MONTH</small><h2>{canReadPayrollAdmin ? 'Prepare payroll' : 'Choose payslip month'}</h2><p>{canReadPayrollAdmin ? 'Pick the month, then generate the salary sheet. You can regenerate it until it is released.' : 'Pick a month to see your payslip.'}</p></div></div><div className="payroll-run-controls"><Field label="Month"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>{canRunPayroll && <button className="primary" onClick={runPayroll}>Generate / remake salary sheet</button>}{currentRun&&<span className={`payroll-run-status ${String(currentRun.status).toLowerCase()}`}>{currentRun.status}</span>}{canRunPayroll&&currentRun?.status==='DRAFT'&&<button className="release-payroll-btn" onClick={releasePayroll}>Release payroll</button>}</div></section>

        {canReadPayrollAdmin && <section className="premium-section-card released-payroll-card"><div className="premium-section-head"><div><small>RELEASED PAYROLL</small><h2>View a released month</h2><p>No salary amount is shown until a released month is selected.</p></div></div><Field label="Released month"><select value={releasedMonth} onChange={(e)=>setReleasedMonth(e.target.value)}><option value="">Select released payroll</option>{finalizedRuns.map((r)=><option key={r._id} value={r.month}>{r.month}</option>)}</select></Field>{releasedRun ? <div className="released-payroll-summary"><div><span>Net payout</span><b>{money(releasedRun.summary?.netTotal)}</b></div><div><span>Gross</span><b>{money(releasedRun.summary?.grossTotal)}</b></div><div><span>Deductions</span><b>{money(releasedRun.summary?.deductionTotal)}</b></div><div><span>Employees</span><b>{releasedRun.summary?.employeeCount||0}</b></div><div className="released-payroll-actions"><button onClick={()=>downloadSalarySheet(releasedRun._id,releasedRun.month,'csv')}>Download CSV</button><button onClick={()=>downloadSalarySheet(releasedRun._id,releasedRun.month,'pdf')}>Download PDF</button></div></div> : <div className="payroll-locked-placeholder"><span>◉</span><div><b>Amounts hidden</b><small>Select a released month above to reveal totals.</small></div></div>}</section>}
      </div>

      {(canRunPayroll || canReadPayrollAdmin) && currentRun && <div style={{ marginBottom: 16 }}><PayrollReview month={month} /></div>}

      {canUpdateSalaryMaster && <details className="premium-collapsible payroll-config-section"><summary><div><small>COMPENSATION SETUP</small><b>Salary Master & bulk Excel</b><span>Collapsed by default to keep the payroll workspace clean.</span></div><em>Open</em></summary><div className="collapsible-body">
        <div className="salary-editor-intro"><div><h3>Automatic statutory salary setup</h3><p>Enter earnings once. HRMS calculates PF, ESI and Professional Tax from the active rule and employee applicability.</p></div><span>WAGES: month days − Sundays</span></div>
        <div className="form-grid">
          <Field label="Employee"><select value={salaryMaster.employeeId} onChange={(e) => setSalaryMaster((s) => ({ ...s, employeeId: e.target.value }))}><option value="">Select employee</option>{employees.map((e) => <option key={e._id} value={e._id}>{e.employeeCode} · {e.firstName} {e.lastName}</option>)}</select></Field>
          <Field label="Effective from month"><input type="month" value={salaryMaster.effectiveMonth} onChange={(e) => setSalaryMaster((s) => ({ ...s, effectiveMonth: e.target.value }))} /></Field>
          <Field label="Basic"><input type="number" value={salaryMaster.earnings.basic} onChange={(e) => setSalaryValue('earnings', 'basic', e.target.value)} /></Field>
          <Field label="HRA"><input type="number" value={salaryMaster.earnings.hra} onChange={(e) => setSalaryValue('earnings', 'hra', e.target.value)} /></Field>
          <Field label="Conveyance"><input type="number" value={salaryMaster.earnings.conveyance} onChange={(e) => setSalaryValue('earnings', 'conveyance', e.target.value)} /></Field>
          <Field label="Special allowance"><input type="number" value={salaryMaster.earnings.specialAllowance} onChange={(e) => setSalaryValue('earnings', 'specialAllowance', e.target.value)} /></Field>
          <Field label="Other earnings"><input type="number" value={salaryMaster.earnings.otherEarnings} onChange={(e) => setSalaryValue('earnings', 'otherEarnings', e.target.value)} /></Field>
          <Field label="Other recurring deduction"><input type="number" value={salaryMaster.deductions.otherDeductions} onChange={(e) => setSalaryValue('deductions', 'otherDeductions', e.target.value)} /></Field>
          <Field label="Deduction mode"><select value={salaryMaster.calculationMode} onChange={(e) => setSalaryMaster((s) => ({ ...s, calculationMode: e.target.value }))}><option value="RULE_BASED_DEDUCTIONS">Automatic PF / ESI / P.Tax</option><option value="MANUAL">Legacy manual mode</option></select></Field>
          <Field label="Notes"><input value={salaryMaster.notes} onChange={(e) => setSalaryMaster((s) => ({ ...s, notes: e.target.value }))} /></Field>
        </div>
        <div className="statutory-preview v24"><div><span>Gross</span><b>{money(salaryGross)}</b></div><div><span>PF · auto</span><b>{money(autoPf)}</b></div><div><span>ESI · auto</span><b>{money(autoEsi)}</b></div><div><span>P.Tax · auto</span><b>{money(autoPtax)}</b></div><div className="accent"><span>Estimated net</span><b>{money(autoNet)}</b></div></div>
        <div className="salary-editor-actions"><button className="primary" onClick={saveSalaryMaster} disabled={!salaryMaster.employeeId}>Save salary master</button><button type="button" onClick={downloadSalaryTemplate}>Download Excel template</button><label className="file-button">Upload salary Excel<input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={importSalaryExcel}/></label></div>

        <div className="salary-master-list-head"><div><small>ACTIVE AT {month}</small><h3>Employee salary structures</h3><p>Values are private by default. Use the eye on an employee to reveal only that salary.</p></div><span>{salaryMasters.length} employee{salaryMasters.length===1?'':'s'}</span></div>
        {!salaryMasters.length ? <Empty /> : <div className="private-salary-list">{salaryMasters.map((m)=>{const open=revealedMasters.includes(m._id);return <article key={m._id} className={open?'revealed':''}><div className="private-salary-row"><div className="salary-person"><span className="employee-mini-avatar">{`${m.employeeId?.firstName?.[0]||''}${m.employeeId?.lastName?.[0]||''}`}</span><div><b>{m.employeeId?.firstName} {m.employeeId?.lastName||''}</b><small>{m.employeeId?.employeeCode} · effective {m.effectiveMonth}</small></div></div><div className="salary-private-state"><span>{open?money(m.netSalary):'••••••'}</span><button aria-label={open?'Hide salary':'Show salary'} onClick={()=>toggleRevealMaster(m._id)}>{open?'◉':'◌'} <b>{open?'Hide':'View'}</b></button></div></div>{open&&<div className="salary-reveal-panel"><div><span>Basic</span><b>{money(m.earnings?.basic)}</b></div><div><span>HRA</span><b>{money(m.earnings?.hra)}</b></div><div><span>Conveyance</span><b>{money(m.earnings?.conveyance)}</b></div><div><span>Special</span><b>{money(m.earnings?.specialAllowance)}</b></div><div><span>Gross</span><b>{money(m.grossSalary)}</b></div><div><span>PF</span><b>{money(m.deductions?.pf)}</b></div><div><span>ESI</span><b>{money(m.deductions?.esi)}</b></div><div><span>P.Tax</span><b>{money(m.deductions?.ptax)}</b></div><div className="accent"><span>Net</span><b>{money(m.netSalary)}</b></div><div className="salary-reveal-actions"><button onClick={()=>editSalaryMaster(m)}>Edit</button><button className="danger-text" onClick={()=>deleteSalaryMaster(m._id)}>Delete</button></div></div>}</article>})}</div>}
      </div></details>}

      {canUpdateRules && <details className="premium-collapsible"><summary><div><small>STATUTORY RULES</small><b>PF / ESI / Professional Tax configuration</b><span>Advanced payroll settings remain closed until needed.</span></div><em>Open</em></summary><div className="collapsible-body"><div className="form-grid">
        <Field label="Rule name"><input value={payRule.name || ''} onChange={(e) => setRule('name', e.target.value)} /></Field>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.pf?.enabled !== false} onChange={(e) => setRule('pf.enabled', e.target.checked)} /><span><b>PF enabled</b></span></label>
        <Field label="PF employee percent"><input type="number" step="0.0001" value={payRule.pf?.employeePercent || 0} onChange={(e) => setRule('pf.employeePercent', Number(e.target.value))} /></Field>
        <Field label="PF employer percent"><input type="number" step="0.0001" value={payRule.pf?.employerPercent || 0} onChange={(e) => setRule('pf.employerPercent', Number(e.target.value))} /></Field>
        <Field label="PF wage cap"><input type="number" value={payRule.pf?.wageCap || 0} onChange={(e) => setRule('pf.wageCap', Number(e.target.value))} /></Field>
        <Field label="PF base"><select value={payRule.pf?.calculationBase || 'BASIC'} onChange={(e) => setRule('pf.calculationBase', e.target.value)}><option>BASIC</option><option>GROSS</option></select></Field>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.esi?.enabled !== false} onChange={(e) => setRule('esi.enabled', e.target.checked)} /><span><b>ESI enabled</b></span></label>
        <Field label="ESI employee percent"><input type="number" step="0.0001" value={payRule.esi?.employeePercent || 0} onChange={(e) => setRule('esi.employeePercent', Number(e.target.value))} /></Field>
        <Field label="ESI employer percent"><input type="number" step="0.0001" value={payRule.esi?.employerPercent || 0} onChange={(e) => setRule('esi.employerPercent', Number(e.target.value))} /></Field>
        <Field label="ESI gross cap"><input type="number" value={payRule.esi?.grossCap || 0} onChange={(e) => setRule('esi.grossCap', Number(e.target.value))} /></Field>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.ptax?.enabled !== false} onChange={(e) => setRule('ptax.enabled', e.target.checked)} /><span><b>P.Tax enabled</b></span></label>
        <Field label="Default P.Tax"><input type="number" value={payRule.ptax?.defaultAmount || 0} onChange={(e) => setRule('ptax.defaultAmount', Number(e.target.value))} /></Field>
        <Field label="Change reason"><input value={payRule.notes || ''} onChange={(e) => setRule('notes', e.target.value)} /></Field>
      </div><details className="details-block"><summary>Advanced custom earnings / deduction JSON</summary><Field label="Custom earnings"><textarea rows="4" value={JSON.stringify(payRule.customEarnings || [], null, 2)} onChange={(e) => { try { setRule('customEarnings', JSON.parse(e.target.value)); } catch (_) {} }} /></Field><Field label="Custom deductions"><textarea rows="4" value={JSON.stringify(payRule.customDeductions || [], null, 2)} onChange={(e) => { try { setRule('customDeductions', JSON.parse(e.target.value)); } catch (_) {} }} /></Field><Field label="P.Tax slabs"><textarea rows="4" value={JSON.stringify(payRule.ptax?.slabs || [], null, 2)} onChange={(e) => { try { setRule('ptax.slabs', JSON.parse(e.target.value)); } catch (_) {} }} /></Field></details><button className="primary" onClick={savePayRule}>Save payroll rule</button></div></details>}

      {canUpdateTemplate && <details className="premium-collapsible"><summary><div><small>PAYSLIP DESIGN</small><b>Payslip PDF designer</b><span>Keep PDF formatting out of the daily payroll workflow.</span></div><em>Open</em></summary><div className="collapsible-body"><div className="form-grid"><Field label="Template name"><input value={template.name || ''} onChange={(e) => setTemplateValue('name', e.target.value)} /></Field><Field label="Company name"><input value={template.companyName || ''} onChange={(e) => setTemplateValue('companyName', e.target.value)} /></Field><Field label="Primary color"><input value={template.primaryColor || ''} onChange={(e) => setTemplateValue('primaryColor', e.target.value)} /></Field><Field label="Company address"><textarea value={template.companyAddress || ''} onChange={(e) => setTemplateValue('companyAddress', e.target.value)} /></Field><Field label="Header text"><textarea value={template.headerText || ''} onChange={(e) => setTemplateValue('headerText', e.target.value)} /></Field><Field label="Footer text"><textarea value={template.footerText || ''} onChange={(e) => setTemplateValue('footerText', e.target.value)} /></Field><label className="switch-row compact-switch"><input type="checkbox" checked={template.showBankLast4 !== false} onChange={(e) => setTemplateValue('showBankLast4', e.target.checked)} /><span><b>Show bank last 4</b></span></label><label className="switch-row compact-switch"><input type="checkbox" checked={template.showPfEsiNumbers !== false} onChange={(e) => setTemplateValue('showPfEsiNumbers', e.target.checked)} /><span><b>Show PF/ESI numbers</b></span></label><label className="switch-row compact-switch"><input type="checkbox" checked={template.showAttendanceSummary !== false} onChange={(e) => setTemplateValue('showAttendanceSummary', e.target.checked)} /><span><b>Show attendance summary</b></span></label></div><button className="primary" onClick={saveTemplate}>Save PDF format</button></div></details>}

      {canSharePayslips && <details className="premium-collapsible"><summary><div><small>DELIVERY</small><b>Manual payslip sharing</b><span>Email / WhatsApp only when you explicitly open and send.</span></div><em>Open</em></summary><div className="collapsible-body"><div className="share-options"><label className="switch-row compact-switch"><input type="checkbox" checked={share.email} onChange={(e) => setShare((s) => ({ ...s, email: e.target.checked }))} /><span><b>Email with PDF</b></span></label><label className="switch-row compact-switch"><input type="checkbox" checked={share.whatsapp} onChange={(e) => setShare((s) => ({ ...s, whatsapp: e.target.checked }))} /><span><b>WhatsApp secure link</b></span></label></div><Field label="Optional message"><textarea value={share.message} onChange={(e) => setShare((s) => ({ ...s, message: e.target.value }))} /></Field><button className="primary" onClick={shareSelected} disabled={!selected.length}>Share selected payslips ({selected.length})</button></div></details>}

      <section className="premium-section-card salary-slip-section"><div className="premium-section-head"><div><small>{monthLabel(month)}</small><h2>{canReadPayrollAdmin ? 'Salary slips' : 'My salary slips'}</h2><p>{canReadPayrollAdmin ? 'Salary figures stay hidden until you click the eye icon.' : 'Click the eye icon to see the amount, or download the PDF.'}</p></div><span>{slips?.slips?.length||0} slips</span></div>
        {!slips?.slips?.length ? <Empty /> : <div className="private-slip-list">{slips.slips.map((s)=>{const open=revealedSlips.includes(s._id);return <article key={s._id} className={open?'revealed':''}><div className="private-slip-row">{canSharePayslips&&<input type="checkbox" checked={selected.includes(s._id)} onChange={()=>toggleSelected(s._id)}/>}<div className="salary-person"><span className="employee-mini-avatar">{`${s.employeeId?.firstName?.[0]||''}${s.employeeId?.lastName?.[0]||''}`}</span><div><b>{s.employeeId?.firstName} {s.employeeId?.lastName||''}</b><small>{s.employeeId?.employeeCode} · {s.month} · payable {s.attendanceStats?.payableDays??0}/{s.attendanceStats?.workingDays??0} days</small></div></div><span className={`lop-chip ${Number(s.attendanceStats?.attendanceLopDays||0)>0?'danger':''}`}>{s.attendanceStats?.attendanceLopDays||0} LOP</span><button className="salary-eye" onClick={()=>toggleRevealSlip(s._id)}>{open?'◉ Hide':'◌ View salary'}</button></div>{open&&<div className="slip-reveal-panel"><div className="salary-reveal-panel"><div><span>Basic</span><b>{money(s.earnings?.basic)}</b></div><div><span>HRA</span><b>{money(s.earnings?.hra)}</b></div><div><span>Conveyance</span><b>{money(s.earnings?.conveyance)}</b></div><div><span>Special</span><b>{money(s.earnings?.specialAllowance)}</b></div><div><span>Gross payable</span><b>{money(s.earnings?.proratedGross)}</b></div><div><span>Deductions</span><b>{money(s.deductions?.total)}</b></div><div className="accent"><span>Net pay</span><b>{money(s.netPay)}</b></div></div><div className="slip-actions"><button onClick={()=>downloadPdf(s._id)}>Download PDF</button><ExplainSlip slipId={s._id}/>{canAdjustPayslips&&<button onClick={()=>adjustSlip(s._id)}>Adjustment</button>}</div></div>}</article>})}</div>}
      </section>
    </div>
  );
}
