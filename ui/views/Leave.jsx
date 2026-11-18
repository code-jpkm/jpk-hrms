import React, { useEffect, useMemo, useState } from 'react';
import LeaveInsight from './leave/LeaveInsight.jsx';
import { AiButton } from '../components/AiKit.jsx';
import '../styles/attendance.css';
import '../styles/v26.css';
import { Card, Empty, ErrorBox, Field } from '../components/Ui.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { canApplyOnBehalf, hasAbility, canSeeWfh } from '../utils/permissions.js';

const statusLabel = (v='') => v.replaceAll('_',' ');
const shortDate = (v) => v ? new Date(v).toLocaleDateString([], { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fullName = (e) => `${e?.firstName || ''} ${e?.lastName || ''}`.trim();

const LEAVE_LABELS = { EL: 'Earned leave', CL: 'Casual leave', SL: 'Sick leave', COMP_OFF: 'Comp off', ML: 'Maternity leave', PL: 'Paternity leave' };

export default function Leave() {
  const { user, employee } = useAuth();
  const showWfh = canSeeWfh(user, employee);
  const allowOnBehalf = canApplyOnBehalf(user);
  const canManage = hasAbility(user, 'LEAVE', 'MANAGE');
  const canApprove = hasAbility(user, 'LEAVE', 'APPROVE') || ['SUPER_ADMIN','HR_ADMIN','MANAGER'].includes(user?.role);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isHrAdmin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);
  const [tab, setTab] = useState('requests');
  const [drawer, setDrawer] = useState(false);
  const [location, setLocation] = useState('ALL');
  const [balanceEmployeeId, setBalanceEmployeeId] = useState(employee?._id || '');
  const [form, setForm] = useState({ employeeId:'', requestType:'LEAVE', leaveType:'LOP', fromDate:'', toDate:'', dayPart:'FULL', reason:'' });
  const [approveNow, setApproveNow] = useState(true);
  const [manual, setManual] = useState({ employeeId:'', leaveType:'COMP_OFF', days:1, grantType:'COMP_OFF', remarks:'' });
  const [policy, setPolicy] = useState({ leaveType:'COMP_OFF', monthlyAccrual:0, yearlyLimit:12, carryForward:true, requiresApproval:true, active:true });
  const [error, setError] = useState(null);

  const { data: employeesData } = useApi('/leaves/employees', []);
  const { data: requests, error: requestError, reload: reloadRequests } = useApi('/leaves/requests', []);
  const { data: policies, error: policyError, reload: reloadPolicies } = useApi('/leaves/policies', []);
  const { data: grants, error: grantError, reload: reloadGrants } = useApi('/leaves/grants', []);
  const employees = employeesData?.employees || [];

  const balanceQuery = balanceEmployeeId ? `/leaves/balances?employeeId=${balanceEmployeeId}` : '';
  const { data: balances, error: balanceError, reload: reloadBalances } = useApi(balanceQuery, [balanceQuery]);
  const requestEmployeeId = form.employeeId || employee?._id || '';
  const requestBalanceQuery = drawer && requestEmployeeId ? `/leaves/balances?employeeId=${requestEmployeeId}` : '';
  const { data: requestBalanceData, reload: reloadRequestBalances } = useApi(requestBalanceQuery, [requestBalanceQuery]);

  const visibleEmployees = useMemo(()=>employees.filter((e)=>location==='ALL'||e.workLocation===location||e.workLocation==='BOTH'),[employees,location]);
  const applicableEmployees = useMemo(() => employees.filter((e) => e.canApplyOnBehalf === true && String(e._id) !== String(employee?._id || '')), [employees, employee?._id]);
  const currentBalanceEmployee = employees.find((e)=>e._id===balanceEmployeeId) || employee;
  const targetEmployee = employees.find((e)=>String(e._id)===String(requestEmployeeId)) || employee;
  // Someone who can approve this person's leave (HR, admin, their manager) and
  // applies on their behalf: the request is approved on the spot.
  const onBehalf = Boolean(allowOnBehalf && form.employeeId && String(form.employeeId) !== String(employee?._id || ''));
  const canApproveTarget = isHrAdmin || hasAbility(user, 'LEAVE', 'APPROVE') || user?.role === 'MANAGER';
  const willAutoApprove = onBehalf ? (canApproveTarget && approveNow) : isSuperAdmin;
  const balanceList = balances?.balances || [];
  const requestBalances = requestBalanceData?.balances || [];
  const positiveBalances = useMemo(() => requestBalances.filter((b)=>Number(b.available||0)>0).sort((a,b)=>String(a.leaveType).localeCompare(String(b.leaveType))), [requestBalances]);
  const availableLeaveTypes = useMemo(() => [...new Set([...positiveBalances.map((b)=>String(b.leaveType).toUpperCase()), 'LOP'])], [positiveBalances]);

  useEffect(() => {
    if (form.requestType !== 'LEAVE') return;
    if (!availableLeaveTypes.includes(form.leaveType)) setForm((f)=>({...f, leaveType: availableLeaveTypes[0] || 'LOP'}));
  }, [availableLeaveTypes, form.requestType, form.leaveType]);

  useEffect(() => {
    if (form.requestType === 'WFH' && targetEmployee?.canApplyWfh !== true) setForm((f)=>({...f, requestType:'LEAVE'}));
  }, [targetEmployee?.canApplyWfh, form.requestType]);

  const pending = (requests?.requests||[]).filter((r)=>r.status==='PENDING');
  const myRequests = (requests?.requests||[]).filter((r)=>String(r.employeeId?._id||r.employeeId)===String(employee?._id));
  const approvalInbox = (requests?.requests||[]).filter((r)=>r.status==='PENDING' && String(r.employeeId?._id||r.employeeId)!==String(employee?._id));
  const upcomingApproved = (requests?.requests||[]).filter((r)=>r.status==='APPROVED' && new Date(r.toDate) >= new Date(Date.now()-86400000)).slice(0, 20);
  const totalAvailable = balanceList.reduce((s,b)=>s+Number(b.available||0),0);

  async function apply(e){
    e.preventDefault(); setError(null);
    try {
      const res = await post('/leaves/apply',{...form,employeeId:allowOnBehalf?form.employeeId||undefined:undefined,toDate:form.toDate||form.fromDate,...(onBehalf&&!approveNow?{sendForApproval:true}:{})},{loadingMessage:willAutoApprove?'Saving and approving…':'Sending for approval…'});
      setDrawer(false);
      setForm({ employeeId:'', requestType:'LEAVE', leaveType:'LOP', fromDate:'', toDate:'', dayPart:'FULL', reason:'' });
      await Promise.all([reloadRequests(), reloadBalances(), reloadRequestBalances()]);
      if (res?.autoApproved) setTab('requests');
    } catch(err){ setError(err); }
  }
  async function withdraw(id){ setError(null); try{ await post(`/leaves/${id}/cancel`,{reason:'Withdrawn by employee'},{loadingMessage:'Withdrawing request…'}); await Promise.all([reloadRequests(),reloadBalances()]); }catch(err){setError(err)} }
  async function cancelApproved(r){ const reason=window.prompt(`Cancel approved ${r.leaveType} for ${fullName(r.employeeId)}? The balance will be returned. Reason:`); if(!reason) return; setError(null); try{ await post(`/leaves/${r._id}/cancel`,{reason},{loadingMessage:'Cancelling leave…'}); await Promise.all([reloadRequests(),reloadBalances()]); }catch(err){setError(err)} }
  async function decide(id,status){ setError(null); try{ await post(`/leaves/${id}/decision`,{status,remarks:status==='APPROVED'?'Approved':'Rejected'}); await Promise.all([reloadRequests(),reloadBalances()]); }catch(err){setError(err)} }
  async function manualAdd(e){e.preventDefault();setError(null);try{await post('/leaves/manual-add',{...manual,days:Number(manual.days)});await Promise.all([reloadBalances(),reloadGrants()]);}catch(err){setError(err)}}
  async function savePolicy(e){e.preventDefault();setError(null);try{await post('/leaves/policies',policy);reloadPolicies();}catch(err){setError(err)}}

  function openRequest(forEmployeeId='') {
    setError(null);
    setForm((f)=>({ ...f, employeeId: allowOnBehalf ? forEmployeeId : '', requestType:'LEAVE', leaveType:'LOP' }));
    setDrawer(true);
  }

  return <div className="nexus-page leave-v4">
    <section className="directory-hero premium-hero leave-hero-v4 page-intro"><div><small>{showWfh?'LEAVE · WFH · COMP OFF · LOP':'LEAVE · COMP OFF · LOP'}</small><h1>Leave & Time Off</h1><p>Apply for leave or work from home, check balances, and approve your team's requests.</p></div><div className="hero-actions"><button className="primary" onClick={()=>openRequest()}>+ Request time off</button>{canApprove&&pending.length>0&&<span className="attention-badge">{pending.length} pending</span>}</div></section>
    <ErrorBox error={error||requestError||policyError||grantError||balanceError}/>

    <section className="leave-balance-strip leave-balance-v4">
      <div className="balance-total"><small>{currentBalanceEmployee?.firstName ? `${currentBalanceEmployee.firstName}'s paid leave` : 'Select an employee to view balance'}</small><b>{totalAvailable} days</b><span>available in total</span></div>
      {balanceList.filter((b)=>Number(b.available||0)>0).slice(0,5).map((b)=><div className="balance-card-mini" key={b._id}><span>{LEAVE_LABELS[b.leaveType] || b.leaveType}</span><b>{b.available}</b><small>{b.used||0} used</small></div>)}
      <div className="balance-card-mini lop-card"><span>Unpaid leave (LOP)</span><b>No limit</b><small>Deducted from salary</small></div>
    </section>

    <div className="workspace-tabs leave-tabs"><button className={tab==='requests'?'active':''} onClick={()=>setTab('requests')}>My requests</button>{canApprove&&<button className={tab==='approvals'?'active':''} onClick={()=>setTab('approvals')}>Approval inbox <em>{approvalInbox.length}</em></button>}<button className={tab==='balances'?'active':''} onClick={()=>setTab('balances')}>Balances</button>{canManage&&<button className={tab==='rules'?'active':''} onClick={()=>setTab('rules')}>HR rules & grants</button>}</div>

    {tab==='requests'&&<Card title="My leave history" actions={<button onClick={()=>openRequest()}>New request</button>}>
      {!myRequests.length?<Empty>No leave requests yet.</Empty>:<div className="leave-request-list leave-history-v4">{myRequests.map((r)=><article key={r._id}><div className="leave-date-block"><b>{shortDate(r.fromDate)}</b><small>{r.toDate&&new Date(r.toDate).toDateString()!==new Date(r.fromDate).toDateString()?`to ${shortDate(r.toDate)}`:statusLabel(r.dayPart)}</small></div><div className="leave-request-main"><strong>{r.requestType==='WFH'?(showWfh?'Work from home':'Approved time off'):r.leaveType==='LOP'?'Unpaid leave (LOP)':`${r.leaveType} leave`}</strong><span>{r.days} day{Number(r.days)!==1?'s':''} · {r.reason||'No reason added'}</span><small>Approver: {r.approverEmployeeId?fullName(r.approverEmployeeId):'HR / reporting manager'}</small></div><span className={`status-pill ${String(r.status).toLowerCase()}`}>{r.status}</span>{r.status==='PENDING'&&<button type="button" className="leave-withdraw" onClick={()=>withdraw(r._id)}>Withdraw</button>}{r.status==='APPROVED'&&isHrAdmin&&<button type="button" className="leave-withdraw" onClick={()=>cancelApproved(r)}>Cancel</button>}</article>)}</div>}
    </Card>}

    {tab==='approvals'&&canApprove&&<Card title="Approval inbox">
      {!approvalInbox.length?<Empty>No pending requests from your team.</Empty>:<div className="leave-request-list approval-list">{approvalInbox.map((r)=><article key={r._id}><span className="employee-mini-avatar">{`${r.employeeId?.firstName?.[0]||''}${r.employeeId?.lastName?.[0]||''}`}</span><div className="leave-request-main"><strong>{r.employeeId?.employeeCode} · {fullName(r.employeeId)}</strong><span>{r.requestType==='WFH'?(showWfh?'WFH':'Time off'):r.leaveType} · {shortDate(r.fromDate)} → {shortDate(r.toDate)} · {r.days} day(s)</span><small>{r.reason||'No reason provided'}</small><LeaveInsight requestId={r._id}/></div><div className="approval-actions"><button className="approve-btn" onClick={()=>decide(r._id,'APPROVED')}>Approve</button><button className="reject-btn" onClick={()=>decide(r._id,'REJECTED')}>Reject</button></div></article>)}</div>}
    </Card>}
    {tab==='approvals'&&isHrAdmin&&upcomingApproved.length>0&&<Card title="Approved & upcoming">
      <div className="leave-request-list approval-list">{upcomingApproved.map((r)=><article key={r._id}><span className="employee-mini-avatar">{`${r.employeeId?.firstName?.[0]||''}${r.employeeId?.lastName?.[0]||''}`}</span><div className="leave-request-main"><strong>{r.employeeId?.employeeCode} · {fullName(r.employeeId)}</strong><span>{r.requestType==='WFH'?'WFH':r.leaveType} · {shortDate(r.fromDate)} → {shortDate(r.toDate)} · {r.days} day(s)</span><small>{r.reason||'No reason provided'}</small></div><div className="approval-actions"><button className="reject-btn" onClick={()=>cancelApproved(r)}>Cancel leave</button></div></article>)}</div>
    </Card>}

    {tab==='balances'&&<Card title="Leave balance explorer">
      {allowOnBehalf&&<div className="calendar-toolbar premium-toolbar"><div className="segmented"><button className={location==='ALL'?'active':''} onClick={()=>setLocation('ALL')}>Both</button><button className={location==='OFFICE'?'active':''} onClick={()=>setLocation('OFFICE')}>Office</button><button className={location==='FACTORY'?'active':''} onClick={()=>setLocation('FACTORY')}>Factory</button></div><Field label="Employee"><select value={balanceEmployeeId} onChange={(e)=>setBalanceEmployeeId(e.target.value)}>{visibleEmployees.map((emp)=><option value={emp._id} key={emp._id}>{emp.employeeCode} · {fullName(emp)}</option>)}</select></Field>{currentBalanceEmployee?.canApplyOnBehalf===true&&<button onClick={()=>openRequest(balanceEmployeeId)}>Apply for this employee</button>}</div>}
      <div className="employee-rule-note"><b>{currentBalanceEmployee?.employeeCode} · {fullName(currentBalanceEmployee)}</b><span>{currentBalanceEmployee?.employeeCategory==='WAGES'?'WAGES: EL accrues at 1.5 days/month. Payroll working days = calendar days minus Sundays.':'SALARIED: paid leave follows configured policy and employee balance.'}</span></div>
      {!balanceList.length?<Empty>No balance records found.</Empty>:<div className="balance-grid">{balanceList.map((b)=><article key={b._id} className={Number(b.available||0)<=0?'zero-balance':''}><span>{b.leaveType}</span><b>{b.available}</b><div><small>Accrued {b.accrued||0}</small><small>Granted {b.manualAdjusted||0}</small><small>Used {b.used||0}</small></div></article>)}</div>}
    </Card>}

    {tab==='rules'&&canManage&&<div className="grid-2 leave-admin-grid">
      <Card title="Grant extra leave / comp off"><form className="form-grid" onSubmit={manualAdd}><Field label="Employee"><select required value={manual.employeeId} onChange={(e)=>setManual({...manual,employeeId:e.target.value})}><option value="">Select employee</option>{employees.map((emp)=><option key={emp._id} value={emp._id}>{emp.employeeCode} · {fullName(emp)} · {emp.workLocation||'FACTORY'}</option>)}</select></Field><Field label="Leave type"><select value={manual.leaveType} onChange={(e)=>setManual({...manual,leaveType:e.target.value})}><option>COMP_OFF</option><option>EL</option><option>CL</option><option>SL</option>{(policies?.policies||[]).map((p)=><option key={p._id}>{p.leaveType}</option>)}</select></Field><Field label="Days"><input type="number" min="0.5" step="0.5" value={manual.days} onChange={(e)=>setManual({...manual,days:e.target.value})}/></Field><Field label="Grant reason"><textarea required rows="3" value={manual.remarks} onChange={(e)=>setManual({...manual,remarks:e.target.value})}/></Field><button className="primary">Grant balance</button></form></Card>
      <Card title="Leave policy"><form className="form-grid" onSubmit={savePolicy}><Field label="Leave type"><input value={policy.leaveType} onChange={(e)=>setPolicy({...policy,leaveType:e.target.value.toUpperCase()})}/></Field><Field label="Monthly accrual"><input type="number" step="0.5" value={policy.monthlyAccrual} onChange={(e)=>setPolicy({...policy,monthlyAccrual:Number(e.target.value)})}/></Field><Field label="Yearly limit"><input type="number" step="0.5" value={policy.yearlyLimit} onChange={(e)=>setPolicy({...policy,yearlyLimit:Number(e.target.value)})}/></Field><label className="switch-row"><input type="checkbox" checked={policy.carryForward} onChange={(e)=>setPolicy({...policy,carryForward:e.target.checked})}/><span>Carry forward</span></label><label className="switch-row"><input type="checkbox" checked={policy.requiresApproval} onChange={(e)=>setPolicy({...policy,requiresApproval:e.target.checked})}/><span>Approval required</span></label><button className="primary">Save policy</button></form></Card>
      <Card title="Recent leave grants"><div className="grant-feed">{!(grants?.grants||[]).length?<Empty/>:(grants.grants||[]).slice(0,12).map((g)=><div key={g._id}><b>{g.employeeId?.employeeCode} · {g.employeeId?.firstName}</b><span>+{g.days} {g.leaveType}</span><small>{g.reason||g.grantType} · {shortDate(g.createdAt)}</small></div>)}</div></Card>
      <Card title="Rules in force"><div className="policy-feed">{(policies?.policies||[]).map((p)=><button key={p._id} onClick={()=>setPolicy({leaveType:p.leaveType,monthlyAccrual:p.monthlyAccrual||0,yearlyLimit:p.yearlyLimit||0,carryForward:p.carryForward!==false,requiresApproval:p.requiresApproval!==false,active:p.active!==false})}><b>{p.leaveType}</b><span>{p.monthlyAccrual||0}/month · {p.yearlyLimit||'—'}/year</span><small>{p.carryForward?'Carry forward':'No carry forward'} · {p.requiresApproval?'Approval':'Auto'}</small></button>)}</div></Card>
    </div>}

    {drawer&&<div className="side-drawer-backdrop" onClick={()=>setDrawer(false)}><aside className="side-drawer leave-drawer leave-drawer-v4" onClick={(e)=>e.stopPropagation()}><div className="drawer-head"><div><small>NEW REQUEST</small><h2>Request time off</h2><p>{targetEmployee?.employeeCode ? `${targetEmployee.employeeCode} · ${fullName(targetEmployee)}` : 'Select employee'}</p></div><button className="icon-close" onClick={()=>setDrawer(false)}>×</button></div><form className="drawer-form" onSubmit={apply}>
      {allowOnBehalf&&<Field label="For employee"><select required={!employee?._id} value={form.employeeId} onChange={(e)=>setForm({...form,employeeId:e.target.value,requestType:'LEAVE'})}><option value="">{employee?._id?'Myself':'Select employee'}</option>{applicableEmployees.map((emp)=><option key={emp._id} value={emp._id}>{emp.employeeCode} · {fullName(emp)} · {emp.workLocation||'FACTORY'}</option>)}</select></Field>}
      <div className="request-type-picker"><button type="button" className={form.requestType==='LEAVE'?'active':''} onClick={()=>setForm({...form,requestType:'LEAVE'})}>Leave</button>{targetEmployee?.canApplyWfh===true&&<button type="button" className={form.requestType==='WFH'?'active':''} onClick={()=>setForm({...form,requestType:'WFH'})}>Work from home</button>}</div>
      {form.requestType==='LEAVE'&&<><Field label="Leave type"><select value={form.leaveType} onChange={(e)=>setForm({...form,leaveType:e.target.value})}>{availableLeaveTypes.map((x)=><option key={x} value={x}>{x==='LOP'?'LOP · Unpaid leave':`${x} · ${positiveBalances.find((b)=>String(b.leaveType).toUpperCase()===x)?.available || 0} days available`}</option>)}</select></Field><div className="leave-type-balance-chips">{positiveBalances.map((b)=><span key={b._id}><b>{b.leaveType}</b> {b.available}</span>)}<span className="lop"><b>LOP</b> always available</span></div></>}
      <div className="drawer-two-col"><Field label="From"><input required type="date" value={form.fromDate} onChange={(e)=>setForm({...form,fromDate:e.target.value,toDate:form.toDate||e.target.value})}/></Field><Field label="To"><input required type="date" min={form.fromDate} value={form.toDate} onChange={(e)=>setForm({...form,toDate:e.target.value})}/></Field></div>
      <Field label="Duration"><select value={form.dayPart} onChange={(e)=>setForm({...form,dayPart:e.target.value})}><option value="FULL">Full day</option><option value="FIRST_HALF">First half</option><option value="SECOND_HALF">Second half</option></select></Field>
      <Field label="Reason"><textarea rows="4" required value={form.reason} onChange={(e)=>setForm({...form,reason:e.target.value})} placeholder="Add a clear reason for the approver"/></Field><AiButton small endpoint="/ai/polish" body={()=>({text:form.reason,purpose:'LEAVE_REASON'})} disabled={!form.reason.trim()} label="Polish with Gemini" onResult={(r)=>setForm((f)=>({...f,reason:r.text}))}/>
      {onBehalf&&canApproveTarget&&<label className="approve-now"><input type="checkbox" checked={approveNow} onChange={(e)=>setApproveNow(e.target.checked)}/><span><b>Approve now</b><small>You are applying for {fullName(targetEmployee)}, so it is approved immediately and their balance is updated. Untick to send it to their manager instead.</small></span></label>}
      <div className="drawer-policy-note">{willAutoApprove?(onBehalf?`This leave will be recorded as approved for ${fullName(targetEmployee)}. They get a notification.`:'Your requests are approved immediately; no second approval is needed.'):form.leaveType==='LOP'&&form.requestType==='LEAVE'?'LOP is unpaid leave and does not use any leave balance.':'It goes to the reporting manager for approval.'}</div><button className="primary drawer-primary">{willAutoApprove?'Save & approve':'Send for approval'}</button>
    </form></aside></div>}
  </div>;
}
