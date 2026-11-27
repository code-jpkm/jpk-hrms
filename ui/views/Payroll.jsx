import { currentMonthKey, monthLabel, shiftMonth, todayKey, formatDayKey } from '../utils/time.js';
import { PayrollReview, ExplainSlip } from './payroll/PayrollAi.jsx';
import SendPayslips from './payroll/SendPayslips.jsx';
import PayslipEditor from './payroll/PayslipEditor.jsx';
import PayrollSheet from './payroll/PayrollSheet.jsx';
import Loans from './payroll/Loans.jsx';
import ImportResult from '../components/ImportResult.jsx';
import Icon from '../components/Icon.jsx';
import '../styles/attendance.css';
import '../styles/v26.css';
import '../styles/payslip.css';
import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, Empty, ErrorBox, Field, Table } from '../components/Ui.jsx';
import { api, post, remove } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';
import { payslipFileName } from '../utils/payslipName.js';

const defaultTemplate = {
  name: 'JPK payslip',
  companyName: '',
  companyAddress: '',
  footerText: '*This is a system generated payslip and does not require signature.',
  bankAccountDisplay: 'FULL',
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

// Professional tax for a gross, as the payroll engine works it out (ptaxForGross in
// server/src/utils/salary.js): slabs are "gross up to" limits, above the last slab pays the default.
function ptaxFor(gross, ptax = {}) {
  const amount = Number(gross || 0);
  const slabs = (ptax.slabs || []).map((s) => ({ from: Number(s.from || 0), to: Number(s.to || Number.MAX_SAFE_INTEGER), amount: Number(s.amount || 0) }));
  const inside = slabs.find((s) => amount >= s.from && amount <= s.to);
  if (inside) return inside.amount;
  const sorted = [...slabs].sort((a, b) => a.from - b.from);
  const seam = sorted.find((s, i) => i > 0 && amount > sorted[i - 1].to && amount < s.from && s.from - sorted[i - 1].to <= 1);
  return seam ? seam.amount : Number(ptax.defaultAmount || 0);
}

export default function Payroll() {
  const { user } = useAuth();
  const canReadPayrollAdmin = hasAbility(user, 'PAYROLL', 'READ');
  const canRunPayroll = hasAbility(user, 'PAYROLL', 'RUN');
  const canUpdateRules = hasAbility(user, 'PAYROLL', 'UPDATE_RULES');
  const canUpdateTemplate = hasAbility(user, 'PAYROLL', 'UPDATE_TEMPLATE');
  const canSharePayslips = hasAbility(user, 'PAYROLL', 'SHARE');
  const canAdjustPayslips = hasAbility(user, 'PAYROLL', 'ADJUST');
  const canUpdateSalaryMaster = hasAbility(user, 'PAYROLL', 'UPDATE_SALARY_MASTER');
  // The last month that has ended: the one HR prepares and employees look for.
  const [month, setMonth] = useState(shiftMonth(currentMonthKey(), -1));
  const { data: runs, error: runsError, reload: reloadRuns } = useApi(canReadPayrollAdmin ? '/payroll/runs' : '', [canReadPayrollAdmin]);
  const { data: slips, error: slipsError, reload: reloadSlips } = useApi(`/payroll/slips?month=${month}`, [month]);
  const { data: templateData, error: templateError, reload: reloadTemplate } = useApi(canReadPayrollAdmin ? '/payroll/payslip-template' : '', [canReadPayrollAdmin]);
  const { data: rulesData, error: rulesError, reload: reloadRules } = useApi(canReadPayrollAdmin ? '/payroll/rules' : '', [canReadPayrollAdmin]);
  const { data: employeesData, error: employeesError } = useApi(canReadPayrollAdmin ? '/payroll/employees' : '', [canReadPayrollAdmin]);
  const { data: salaryMastersData, error: salaryMastersError, reload: reloadSalaryMasters } = useApi(canReadPayrollAdmin ? `/payroll/salary-masters?activeAt=${month}` : '', [month, canReadPayrollAdmin]);
  const [payRule, setPayRule] = useState({ name: 'Default Payroll Rule', pf: { enabled: true, employeePercent: 0.12, employerPercent: 0.12, wageCap: 15000, calculationBase: 'BASIC', applyWageCap: false }, esi: { enabled: true, employeePercent: 0.0075, employerPercent: 0.0325, grossCap: 21000, calculationBase: 'BASIC' }, ptax: { enabled: true, defaultAmount: 208, slabs: [{ from: 0, to: 20000, amount: 0 }, { from: 20001, to: 30000, amount: 100 }, { from: 30001, to: 50000, amount: 140 }, { from: 50001, to: 100000, amount: 170 }] }, customEarnings: [], customDeductions: [], notes: '' });
  const [template, setTemplate] = useState(defaultTemplate);
  const [sendOpen, setSendOpen] = useState(false);
  const [editingSlip, setEditingSlip] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [salaryMaster, setSalaryMaster] = useState({ employeeId: '', effectiveMonth: currentMonthKey(), earnings: { basic: 0, hra: 0, conveyance: 0, specialAllowance: 0, otherEarnings: 0 }, deductions: { pf: 0, esi: 0, ptax: 0, otherDeductions: 0 }, calculationMode: 'RULE_BASED_DEDUCTIONS', notes: '' });
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [releasedMonth, setReleasedMonth] = useState('');
  const [revealedMasters, setRevealedMasters] = useState([]);
  const [revealedSlips, setRevealedSlips] = useState([]);
  const [salaryImport, setSalaryImport] = useState(null);

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
  // Same rounding as the payroll engine: whole rupees unless the rule keeps paise.
  const roundPay = (v) => (payRule.roundToRupee === false ? Math.round(v * 100) / 100 : Math.round(v));
  const autoPf = payRule.pf?.enabled === false || salaryEmployee?.statutory?.pfApplicable === false ? 0 : roundPay(autoPfCapped * pct(payRule.pf?.employeePercent, .12));
  const autoEsiBase = payRule.esi?.calculationBase === 'BASIC' ? Number(salaryMaster.earnings.basic || 0) : salaryGross;
  const autoEsi = payRule.esi?.enabled === false || salaryEmployee?.statutory?.esiApplicable === false || (payRule.esi?.grossCap && autoEsiBase > Number(payRule.esi.grossCap)) ? 0 : roundPay(autoEsiBase * pct(payRule.esi?.employeePercent, .0075));
  const autoPtax = payRule.ptax?.enabled === false || salaryEmployee?.statutory?.ptaxApplicable === false || salaryGross <= 0 ? 0 : ptaxFor(salaryGross, payRule.ptax);
  const autoNet = salaryGross - autoPf - autoEsi - autoPtax - Number(salaryMaster.deductions.otherDeductions || 0);
  const currentRun = useMemo(() => (runs?.runs || []).find((r) => r.month === month), [runs, month]);
  // Days with a missing out time are paid as present until HR decides them on the attendance calendar.
  const waiting = useMemo(() => {
    const rows = (slips?.slips || []).filter((s) => Number(s.attendanceStats?.reviewDays || 0) > 0);
    return { people: rows.length, days: rows.reduce((t, s) => t + Number(s.attendanceStats.reviewDays || 0), 0) };
  }, [slips]);
  const finalizedRuns = useMemo(() => (runs?.runs || []).filter((r) => r.status === 'FINALIZED'), [runs]);
  const releasedRun = useMemo(() => finalizedRuns.find((r) => r.month === releasedMonth), [finalizedRuns, releasedMonth]);
  const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const monthSlips = slips?.slips || [];
  const isReleased = currentRun?.status === 'FINALIZED';
  // Payroll lock: a month's payroll opens on the 1st of the next month (server decides; this mirrors it).
  const lockOn = runs?.lock ? runs.lock.on : payRule.lockUntilMonthEnds !== false;
  const opensOn = `${shiftMonth(month, 1)}-01`;
  const monthLocked = lockOn && (runs?.lock?.today || todayKey()) < opensOn;
  const opensOnLabel = formatDayKey(opensOn, { day: 'numeric', month: 'long', year: 'numeric' });
  const changedAfterSending = (s) => Boolean(s.lastSharedAt && s.contentChangedAt && new Date(s.contentChangedAt) > new Date(s.lastSharedAt));
  const sentCount = monthSlips.filter((s) => s.lastSharedAt).length;
  const resendCount = monthSlips.filter(changedAfterSending).length;
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
    try { const dataUrl=await fileToDataUrl(file); const res=await post('/payroll/salary-masters/import-excel',{fileName:file.name,dataUrl}); setSalaryImport({ fileName: file.name, ...res }); setMessage(`Salary Excel import complete: ${res.saved || 0} saved${res.errors ? `, ${res.errors} error(s)` : ''}. PF, ESI and P.Tax were calculated automatically.`); reloadSalaryMasters(); }
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

  async function deletePayroll() {
    if (!currentRun?._id) return;
    const label = monthLabel(currentRun.month);
    const released = currentRun.status === 'FINALIZED';
    const count = Number(currentRun.summary?.employeeCount || 0);
    let reason = '';
    if (released) {
      reason = window.prompt(`Payroll for ${label} is RELEASED. Deleting it removes every payslip of the month, including any employees already received.\n\nType a reason to delete it:`) || '';
      if (!reason.trim()) return;
    } else if (!window.confirm(`Delete the ${label} payroll draft?\n\n${count ? `Its ${count} salary slip${count === 1 ? '' : 's'} will be removed. ` : 'Its salary slips will be removed. '}Attendance, salaries and loans are not touched, and you can generate ${label} again later.`)) return;
    setError(null); setMessage('');
    try {
      const res = await remove(`/payroll/runs/${currentRun._id}`, { body: JSON.stringify({ reason }), loadingMessage: `Deleting ${label} payroll…`, successMessage: `${label} payroll deleted.` });
      setMessage(res?.message || `${label} payroll deleted.`);
      reloadRuns(); reloadSlips();
    } catch (err) { setError(err); }
  }

  async function releasePayroll() {
    if (!currentRun?._id) return;
    const pending = waiting.days ? `\n\n${waiting.people} employee(s) still have ${waiting.days} day(s) with a missing out time. They are paid as present unless you decide them on the attendance calendar first.` : '';
    if (!window.confirm(`Release payroll for ${currentRun.month}?\n\nNobody is notified. You can still edit any payslip after release, then send payslips to the people you choose.${pending}`)) return;
    setError(null); setMessage('');
    try {
      await post(`/payroll/runs/${currentRun._id}/release`, { reason: `Payroll ${currentRun.month} approved for release` }, { loadingMessage: `Releasing ${currentRun.month} payroll…`, successMessage: `Payroll ${currentRun.month} released. Nobody was notified.` });
      setMessage(`Payroll ${currentRun.month} released. Nobody was notified. Edit any payslip if needed, then use Send payslips.`);
      setReleasedMonth(currentRun.month);
      reloadRuns(); reloadSlips();
    } catch (err) { setError(err); }
  }

  async function downloadPdf(slip) {
    setError(null);
    try {
      const blob = await api(`/payroll/slips/${slip._id}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fileName = payslipFileName(slip.employeeId, slip.month || month);
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
      toast.success(`${fileName} downloaded`);
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
      a.download = `${format === 'xlsx' ? 'salary-statement' : 'salary-sheet'}-${runMonth}.${format}`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
      toast.success(`Salary ${format === 'xlsx' ? 'statement Excel' : `sheet ${String(format).toUpperCase()}`} download started`);
    } catch (err) { setError(err); toast.error(err.message || 'Could not download salary sheet'); }
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
  function slipState(s) {
    if (changedAfterSending(s)) return <span className="slip-state edited" title="Changed after it was sent. Send it again so the employee has the corrected payslip.">Changed after sending</span>;
    if (s.lastSharedAt) return <span className="slip-state sent" title={`Sent ${new Date(s.lastSharedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`}>Sent</span>;
    if (s.edits) return <span className="slip-state edited">Edited</span>;
    return null;
  }

  return (
    <div className="nexus-page payroll-v24">
      <section className="directory-hero premium-hero page-intro"><div><small>COMPENSATION & COMPLIANCE</small><h1>{canReadPayrollAdmin ? 'Payroll Command Center' : 'My Payroll'}</h1><p>{canReadPayrollAdmin ? 'Generate the monthly salary sheet, check it, release payslips and send them to employees. Salary figures stay hidden until you click the eye.' : 'Your payslips, month by month. Download any month as a PDF.'}</p></div></section>
      <ErrorBox error={error || runsError || slipsError || templateError || rulesError || employeesError || salaryMastersError} />

      <div className="payroll-top-grid">
        <section className="premium-section-card payroll-run-card"><div className="premium-section-head"><div><small>CURRENT MONTH</small><h2>{canReadPayrollAdmin ? 'Prepare payroll' : 'Choose payslip month'}</h2><p>{canReadPayrollAdmin ? 'Pick the month, then generate the salary sheet. You can regenerate it until it is released.' : 'Pick a month to see your payslip.'}</p></div></div><div className="payroll-run-controls"><Field label="Month"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>{canRunPayroll && <button className="primary" onClick={runPayroll} disabled={monthLocked} title={monthLocked ? `Opens on ${opensOnLabel}` : undefined}>Generate / remake salary sheet</button>}{currentRun&&<span className={`payroll-run-status ${String(currentRun.status).toLowerCase()}`}>{currentRun.status}</span>}{canRunPayroll&&currentRun?.status==='DRAFT'&&!monthLocked&&<button className="release-payroll-btn" onClick={releasePayroll}>Release payroll</button>}{canRunPayroll&&currentRun&&(currentRun.status==='DRAFT'||user?.role==='SUPER_ADMIN')&&<button type="button" className="v26-btn danger" onClick={deletePayroll}>Delete payroll</button>}</div>{canRunPayroll&&monthLocked&&<p className="payroll-review-note">{monthLabel(month)} payroll opens on {opensOnLabel}, after the month ends.{currentRun ? ' This draft was made earlier: delete it, and generate the month again once it opens.' : ''}</p>}{canReadPayrollAdmin&&currentRun?.status==='DRAFT'&&waiting.days>0&&<p className="payroll-review-note">{waiting.people} employee{waiting.people===1?'':'s'} {waiting.people===1?'has':'have'} {waiting.days} day{waiting.days===1?'':'s'} with a missing out time (yellow on the attendance calendar). They are paid as present until decided; deciding a day there updates this draft at once.</p>}{canReadPayrollAdmin&&currentRun&&<div className="payroll-statement-row"><span><Icon name="FileSpreadsheet" size={15}/> Salary statement · {monthLabel(currentRun.month)}</span><button type="button" onClick={()=>downloadSalarySheet(currentRun._id,currentRun.month,'xlsx')}><Icon name="Download" size={14}/> Excel</button><button type="button" onClick={()=>downloadSalarySheet(currentRun._id,currentRun.month,'pdf')}><Icon name="Download" size={14}/> PDF</button><button type="button" onClick={()=>downloadSalarySheet(currentRun._id,currentRun.month,'csv')}><Icon name="Download" size={14}/> CSV</button></div>}{canSharePayslips&&currentRun&&<div className="payroll-send-row">{isReleased?<><button className="primary" onClick={()=>setSendOpen(true)} disabled={!monthSlips.length}><Icon name="SendHorizontal" size={15}/> Send payslips</button><small>{sentCount} of {monthSlips.length} sent{resendCount?` · ${resendCount} changed after sending`:''}</small></>:<small>Nobody is notified on release. After release you can still edit payslips, then send them to the people you choose.</small>}</div>}</section>

        {canReadPayrollAdmin && <section className="premium-section-card released-payroll-card"><div className="premium-section-head"><div><small>RELEASED PAYROLL</small><h2>View a released month</h2><p>No salary amount is shown until a released month is selected.</p></div></div><Field label="Released month"><select value={releasedMonth} onChange={(e)=>setReleasedMonth(e.target.value)}><option value="">Select released payroll</option>{finalizedRuns.map((r)=><option key={r._id} value={r.month}>{r.month}</option>)}</select></Field>{releasedRun ? <div className="released-payroll-summary"><div><span>Net payout</span><b>{money(releasedRun.summary?.netTotal)}</b></div><div><span>Gross</span><b>{money(releasedRun.summary?.grossTotal)}</b></div><div><span>Deductions</span><b>{money(releasedRun.summary?.deductionTotal)}</b></div><div><span>Employees</span><b>{releasedRun.summary?.employeeCount||0}</b></div><div className="released-payroll-actions"><button onClick={()=>downloadSalarySheet(releasedRun._id,releasedRun.month,'xlsx')}>Download Excel</button><button onClick={()=>downloadSalarySheet(releasedRun._id,releasedRun.month,'csv')}>Download CSV</button><button onClick={()=>downloadSalarySheet(releasedRun._id,releasedRun.month,'pdf')}>Download PDF</button></div></div> : <div className="payroll-locked-placeholder"><span>◉</span><div><b>Amounts hidden</b><small>Select a released month above to reveal totals.</small></div></div>}</section>}
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
        {salaryImport && <ImportResult title={`Salary Excel · ${salaryImport.fileName}`} facts={[`${salaryImport.saved || 0} saved`, 'PF, ESI and P.Tax worked out by the HRMS']} errors={(salaryImport.results || []).filter((r) => r.status === 'ERROR').map((r) => ({ row: r.row, employeeCode: r.employeeCode, message: r.reason }))} onClose={() => setSalaryImport(null)} />}

        <div className="salary-master-list-head"><div><small>ACTIVE AT {month}</small><h3>Employee salary structures</h3><p>Values are private by default. Use the eye on an employee to reveal only that salary.</p></div><span>{salaryMasters.length} employee{salaryMasters.length===1?'':'s'}</span></div>
        {!salaryMasters.length ? <Empty /> : <div className="private-salary-list">{salaryMasters.map((m)=>{const open=revealedMasters.includes(m._id);return <article key={m._id} className={open?'revealed':''}><div className="private-salary-row"><div className="salary-person"><span className="employee-mini-avatar">{`${m.employeeId?.firstName?.[0]||''}${m.employeeId?.lastName?.[0]||''}`}</span><div><b>{m.employeeId?.firstName} {m.employeeId?.lastName||''}</b><small>{m.employeeId?.employeeCode} · effective {m.effectiveMonth}</small></div></div><div className="salary-private-state"><span>{open?money(m.netSalary):'••••••'}</span><button aria-label={open?'Hide salary':'Show salary'} onClick={()=>toggleRevealMaster(m._id)}>{open?'◉':'◌'} <b>{open?'Hide':'View'}</b></button></div></div>{open&&<div className="salary-reveal-panel"><div><span>Basic</span><b>{money(m.earnings?.basic)}</b></div><div><span>HRA</span><b>{money(m.earnings?.hra)}</b></div><div><span>Conveyance</span><b>{money(m.earnings?.conveyance)}</b></div><div><span>Special</span><b>{money(m.earnings?.specialAllowance)}</b></div><div><span>Gross</span><b>{money(m.grossSalary)}</b></div><div><span>PF</span><b>{money(m.deductions?.pf)}</b></div><div><span>ESI</span><b>{money(m.deductions?.esi)}</b></div><div><span>P.Tax</span><b>{money(m.deductions?.ptax)}</b></div><div className="accent"><span>Net</span><b>{money(m.netSalary)}</b></div><div className="salary-reveal-actions"><button onClick={()=>editSalaryMaster(m)}>Edit</button><button className="danger-text" onClick={()=>deleteSalaryMaster(m._id)}>Delete</button></div></div>}</article>})}</div>}
      </div></details>}

      {canReadPayrollAdmin && <details className="premium-collapsible"><summary><div><small>LOANS</small><b>Loans and salary advances</b><span>The EMI comes off the payslip every month until the loan is recovered.</span></div><em>Open</em></summary><div className="collapsible-body"><Loans employees={employees} canEdit={canUpdateSalaryMaster} onChanged={reloadSlips} /></div></details>}

      {canUpdateRules && <details className="premium-collapsible"><summary><div><small>STATUTORY RULES</small><b>PF / ESI / Professional Tax configuration</b><span>Advanced payroll settings remain closed until needed.</span></div><em>Open</em></summary><div className="collapsible-body"><div className="form-grid">
        <Field label="Rule name"><input value={payRule.name || ''} onChange={(e) => setRule('name', e.target.value)} /></Field>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.pf?.enabled !== false} onChange={(e) => setRule('pf.enabled', e.target.checked)} /><span><b>PF enabled</b></span></label>
        <Field label="PF employee percent"><input type="number" step="0.0001" value={payRule.pf?.employeePercent || 0} onChange={(e) => setRule('pf.employeePercent', Number(e.target.value))} /></Field>
        <Field label="PF employer percent"><input type="number" step="0.0001" value={payRule.pf?.employerPercent || 0} onChange={(e) => setRule('pf.employerPercent', Number(e.target.value))} /></Field>
        <Field label="PF wage cap"><input type="number" value={payRule.pf?.wageCap || 0} onChange={(e) => setRule('pf.wageCap', Number(e.target.value))} /></Field>
        <Field label="PF base"><select value={payRule.pf?.calculationBase || 'BASIC'} onChange={(e) => setRule('pf.calculationBase', e.target.value)}><option>BASIC</option><option>GROSS</option></select></Field>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.pf?.applyWageCap === false} onChange={(e) => setRule('pf.applyWageCap', !e.target.checked)} /><span><b>PF on the full Basic</b><small>On: 12% of the whole Basic, as in greytHR. Off: PF stops at the wage cap.</small></span></label>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.esi?.enabled !== false} onChange={(e) => setRule('esi.enabled', e.target.checked)} /><span><b>ESI enabled</b></span></label>
        <Field label="ESI employee percent"><input type="number" step="0.0001" value={payRule.esi?.employeePercent || 0} onChange={(e) => setRule('esi.employeePercent', Number(e.target.value))} /></Field>
        <Field label="ESI employer percent"><input type="number" step="0.0001" value={payRule.esi?.employerPercent || 0} onChange={(e) => setRule('esi.employerPercent', Number(e.target.value))} /></Field>
        <Field label="ESI on"><select value={payRule.esi?.calculationBase || 'GROSS'} onChange={(e) => setRule('esi.calculationBase', e.target.value)}><option value="BASIC">Basic</option><option value="GROSS">Gross</option></select></Field>
        <Field label={payRule.esi?.calculationBase === 'BASIC' ? 'No ESI when Basic is above' : 'No ESI when gross is above'}><input type="number" value={payRule.esi?.grossCap || 0} onChange={(e) => setRule('esi.grossCap', Number(e.target.value))} /></Field>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.ptax?.enabled !== false} onChange={(e) => setRule('ptax.enabled', e.target.checked)} /><span><b>P.Tax enabled</b></span></label>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.roundToRupee !== false} onChange={(e) => setRule('roundToRupee', e.target.checked)} /><span><b>Whole rupees</b><small>Round LOP, salary parts and PF / ESI to the rupee, like the JPK payslip</small></span></label>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.lopDayBasis !== 'WORKING_DAYS'} onChange={(e) => setRule('lopDayBasis', e.target.checked ? 'CALENDAR_DAYS' : 'WORKING_DAYS')} /><span><b>LOP per day on all days of the month</b><small>On: one LOP day is the month's salary ÷ all its days (÷31 in October), like the JPK payslip and greytHR; Sundays and holidays are paid. Off: ÷ the working days only. Wages staff always use the days less Sundays.</small></span></label>
        <label className="switch-row compact-switch"><input type="checkbox" checked={payRule.lockUntilMonthEnds !== false} onChange={(e) => setRule('lockUntilMonthEnds', e.target.checked)} /><span><b>Lock payroll until the month ends</b><small>On: a month's payroll can be generated from the 1st of the next month (November from 1 December), and employees never see a payslip for a month that has not ended.</small></span></label>
        <Field label="Change reason"><input value={payRule.notes || ''} onChange={(e) => setRule('notes', e.target.value)} /></Field>
      </div><PtaxSlabEditor ptax={payRule.ptax || {}} onChange={(next) => setRule('ptax', next)} /><details className="details-block"><summary>Advanced custom earnings / deduction JSON</summary><Field label="Custom earnings"><textarea rows="4" value={JSON.stringify(payRule.customEarnings || [], null, 2)} onChange={(e) => { try { setRule('customEarnings', JSON.parse(e.target.value)); } catch (_) {} }} /></Field><Field label="Custom deductions"><textarea rows="4" value={JSON.stringify(payRule.customDeductions || [], null, 2)} onChange={(e) => { try { setRule('customDeductions', JSON.parse(e.target.value)); } catch (_) {} }} /></Field></details><button className="primary" onClick={savePayRule}>Save payroll rule</button></div></details>}

      {canUpdateTemplate && <details className="premium-collapsible"><summary><div><small>PAYSLIP DESIGN</small><b>Payslip PDF</b><span>Company heading, footer line and what the payslip shows.</span></div><em>Open</em></summary><div className="collapsible-body"><div className="form-grid"><Field label="Template name"><input value={template.name || ''} onChange={(e) => setTemplateValue('name', e.target.value)} /></Field><Field label="Company name" hint="Empty: the company name from Settings."><input value={template.companyName || ''} onChange={(e) => setTemplateValue('companyName', e.target.value)} /></Field><Field label="Company address" hint="Printed under the company name. Empty: the office address."><textarea value={template.companyAddress || ''} onChange={(e) => setTemplateValue('companyAddress', e.target.value)} /></Field><Field label="Footer line"><textarea value={template.footerText || ''} onChange={(e) => setTemplateValue('footerText', e.target.value)} /></Field><Field label="Bank account number"><select value={template.bankAccountDisplay || 'FULL'} onChange={(e) => setTemplateValue('bankAccountDisplay', e.target.value)}><option value="FULL">Full number</option><option value="LAST4">Only the last 4 digits</option><option value="HIDE">Do not show</option></select></Field><label className="switch-row compact-switch"><input type="checkbox" checked={template.showPfEsiNumbers !== false} onChange={(e) => setTemplateValue('showPfEsiNumbers', e.target.checked)} /><span><b>Show PF No. and UAN</b></span></label><label className="switch-row compact-switch"><input type="checkbox" checked={template.showAttendanceSummary !== false} onChange={(e) => setTemplateValue('showAttendanceSummary', e.target.checked)} /><span><b>Show work days and LOP</b></span></label></div><button className="primary" onClick={saveTemplate}>Save PDF format</button></div></details>}

      <section className="premium-section-card salary-slip-section"><div className="premium-section-head"><div><small>{monthLabel(month)}</small><h2>{canReadPayrollAdmin ? 'Salary slips' : 'My salary slips'}</h2><p>{canReadPayrollAdmin ? `Salary figures stay hidden until you click the eye icon.${canAdjustPayslips ? ' Edit opens the payslip to change any amount or add a line or a note.' : ''}` : 'Click the eye icon to see the amount, or download the PDF.'}</p></div><div className="slip-section-tools">{canReadPayrollAdmin && currentRun && <button type="button" className="primary payroll-sheet-open" onClick={() => setSheetOpen(true)}><Icon name="FileSpreadsheet" size={16} /> {canAdjustPayslips ? 'Edit in payroll sheet' : 'Open payroll sheet'}</button>}<span>{monthSlips.length} slips</span></div></div>
        {!slips?.slips?.length ? <Empty /> : <div className="private-slip-list">{slips.slips.map((s)=>{const open=revealedSlips.includes(s._id);return <article key={s._id} className={open?'revealed':''}><div className="private-slip-row ps-slip-row"><div className="salary-person"><span className="employee-mini-avatar">{`${s.employeeId?.firstName?.[0]||''}${s.employeeId?.lastName?.[0]||''}`}</span><div><b>{s.employeeId?.firstName} {s.employeeId?.lastName||''}</b><small>{s.employeeId?.employeeCode} · {s.month} · payable {s.attendanceStats?.payableDays??0}/{s.attendanceStats?.workingDays??0} days</small></div></div><div className="ps-slip-right">{canReadPayrollAdmin&&slipState(s)}<span className={`lop-chip ${Number(s.attendanceStats?.attendanceLopDays||0)>0?'danger':''}`}>{s.attendanceStats?.attendanceLopDays||0} LOP</span><button className="salary-eye" onClick={()=>toggleRevealSlip(s._id)}>{open?'◉ Hide':'◌ View salary'}</button>{canAdjustPayslips&&<button className="salary-eye ps-edit-btn" onClick={()=>setEditingSlip(s._id)} aria-label={`Edit the payslip of ${s.employeeId?.firstName||'this employee'}`}><Icon name="Pencil" size={13}/> Edit</button>}</div></div>{open&&<div className="slip-reveal-panel"><div className="salary-reveal-panel"><div><span>Basic</span><b>{money(s.earnings?.basic)}</b></div><div><span>HRA</span><b>{money(s.earnings?.hra)}</b></div><div><span>Conveyance</span><b>{money(s.earnings?.conveyance)}</b></div><div><span>Special</span><b>{money(s.earnings?.specialAllowance)}</b></div><div><span>Total earnings</span><b>{money(s.earnings?.total ?? s.earnings?.proratedGross)}</b></div><div><span>Deductions</span><b>{money(s.deductions?.total)}</b></div><div className="accent"><span>Net pay</span><b>{money(s.netPay)}</b></div></div><div className="slip-actions"><button onClick={()=>downloadPdf(s)}>Download PDF</button><ExplainSlip slipId={s._id}/></div></div>}</article>})}</div>}
      </section>

      {sendOpen && <SendPayslips month={month} slips={monthSlips} onClose={() => setSendOpen(false)} onSent={() => reloadSlips()} />}
      {sheetOpen && currentRun && <PayrollSheet runId={currentRun._id} month={month} onClose={() => setSheetOpen(false)} onSaved={() => { reloadSlips(); reloadRuns(); }} />}
      {editingSlip && <PayslipEditor slipId={editingSlip} canEdit={canAdjustPayslips} onClose={() => setEditingSlip('')} onSaved={() => { reloadSlips(); reloadRuns(); }} />}
    </div>
  );
}

/** Professional tax slabs as "gross up to → tax" rows, plus the tax above the last slab. */
function PtaxSlabEditor({ ptax, onChange }) {
  const slabs = ptax.slabs || [];
  const rupees = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
  const limit = (s) => (s?.to === '' || s?.to === null || s?.to === undefined ? '' : Number(s.to));
  // Each slab starts a rupee above the one before, as greytHR's "IF(gross <= limit…)" reads.
  const save = (list) => onChange({ ...ptax, slabs: list.map((s, i) => ({ from: i === 0 ? 0 : Number(limit(list[i - 1]) || 0) + 1, to: limit(s), amount: Number(s.amount || 0) })) });
  const setRow = (i, key, value) => save(slabs.map((s, j) => (j === i ? { ...s, [key]: value === '' ? '' : Number(value) } : s)));
  const inOrder = () => save([...slabs].sort((a, b) => Number(limit(a) || Number.MAX_SAFE_INTEGER) - Number(limit(b) || Number.MAX_SAFE_INTEGER)));
  const last = slabs.length ? Number(limit(slabs[slabs.length - 1]) || 0) : 0;
  return <div className="ptax-slabs">
    <div className="ptax-slabs-head"><b>Professional tax slabs</b><span>On the month's gross. Each row: gross up to the limit pays that tax.</span></div>
    {slabs.map((s, i) => <div className="ptax-slab-row" key={i}>
      <span>{i === 0 ? 'Gross up to' : `${rupees(Number(limit(slabs[i - 1]) || 0) + 1)} up to`}</span>
      <input type="number" min="0" aria-label={`Slab ${i + 1}: gross up to`} value={limit(s)} onChange={(e) => setRow(i, 'to', e.target.value)} onBlur={inOrder} />
      <span>tax ₹</span>
      <input type="number" min="0" aria-label={`Slab ${i + 1}: tax`} value={s.amount ?? 0} onChange={(e) => setRow(i, 'amount', e.target.value)} />
      <button type="button" onClick={() => save(slabs.filter((_, j) => j !== i))}>Remove</button>
    </div>)}
    <div className="ptax-slab-row above">
      <span>{slabs.length ? `Above ${rupees(last)}` : 'Any gross'}</span>
      <span />
      <span>tax ₹</span>
      <input type="number" min="0" aria-label="Tax above the last slab" value={ptax.defaultAmount ?? 0} onChange={(e) => onChange({ ...ptax, defaultAmount: Number(e.target.value || 0) })} />
      <span />
    </div>
    <button type="button" className="ptax-add" onClick={() => save([...slabs, { to: last + 10000, amount: 0 }])}>Add slab</button>
  </div>;
}
