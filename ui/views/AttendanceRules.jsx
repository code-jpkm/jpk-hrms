import { currentMonthKey } from '../utils/time.js';
import React,{useEffect,useMemo,useState}from'react';
import{Empty,ErrorBox,Field}from'../components/Ui.jsx';
import{post}from'../api/client.js';
import{useApi}from'../hooks/useApi.js';
import{useAuth}from'../state/AuthContext.jsx';
import{hasAbility}from'../utils/permissions.js';

export default function AttendanceRules(){
 const{user}=useAuth();
 const canManage=hasAbility(user,'ATTENDANCE_RULES','MANAGE');
 const canEvaluate=hasAbility(user,'ATTENDANCE','EVALUATE')||['SUPER_ADMIN','HR_ADMIN'].includes(user?.role);
 const{data,error,reload}=useApi('/attendance-policy',[]);
 const[form,setForm]=useState({timezoneOffsetMinutes:330,lateGraceMinutes:15,lateGraceDaysPerMonth:3,lateLopAfterGraceDays:.5,permissionLimitPerMonth:3,earlyLeaveAllowedMinutes:15,earlyLeavePermissionRequiredAfterMinutes:15,earlyLeaveHalfDayAfterMinutes:120,earlyLeaveLopDays:.5,medicalSpecialRequiresHr:true,customRules:[]});
 const[sim,setSim]=useState({late:20,early:0,instance:1,permission:false});
 const[custom,setCustom]=useState({name:'',condition:'LATE_IN_MINUTES_GT',thresholdMinutes:30,lopDays:.5,priority:100,active:true});
 const[month,setMonth]=useState(currentMonthKey());
 const[submitError,setSubmitError]=useState(null);
 useEffect(()=>{if(data?.policy)setForm((f)=>({...f,...data.policy,customRules:data.policy.customRules||[]}))},[data]);
 const quota=Number(form.permissionLimitPerMonth||3);
 const simulation=useMemo(()=>{
   const late=Math.max(0,Number(sim.late||0));
   const early=Math.max(0,Number(sim.early||0));
   const instance=Math.max(1,Number(sim.instance||1));
   const hardHalf=early>Number(form.earlyLeaveHalfDayAfterMinutes||120);
   if(hardHalf&&!sim.permission) return {result:'Half day · 0.5 LOP',detail:`Early leave ${early}m crosses the ${form.earlyLeaveHalfDayAfterMinutes}m half-day threshold. The monthly exception quota does not cancel this hard threshold.`,lop:Number(form.earlyLeaveLopDays||.5),tone:'danger'};
   if(!late&&!early) return {result:'On time',detail:'No late-in or early-leave exception.',lop:0,tone:'good'};
   if(sim.permission) return {result:'Specially approved',detail:'Approved medical/special permission protects this exception.',lop:0,tone:'good'};
   if(instance<=quota) return {result:`Permitted · exception ${instance}/${quota}`,detail:`This is inside the combined monthly late + early quota. No LOP is applied.`,lop:0,tone:'good'};
   const lop=Number(form.lateLopAfterGraceDays||.5);
   return {result:`${lop} LOP`,detail:`The combined monthly quota of ${quota} events is exhausted. This later exception is deductible.`,lop,tone:'danger'};
 },[sim,form,quota]);
 function set(k,v){setForm((f)=>({...f,[k]:v}))}
 function setQuota(v){const n=Number(v);setForm((f)=>({...f,permissionLimitPerMonth:n,lateGraceDaysPerMonth:n}))}
 function addCustom(){if(!custom.name)return;setForm((f)=>({...f,customRules:[...(f.customRules||[]),custom]}));setCustom({name:'',condition:'LATE_IN_MINUTES_GT',thresholdMinutes:30,lopDays:.5,priority:100,active:true})}
 async function save(e){e.preventDefault();setSubmitError(null);try{await post('/attendance-policy',form,{loadingMessage:'Saving attendance policy…',successMessage:'Attendance policy saved'});reload()}catch(err){setSubmitError(err)}}
 async function evaluate(){setSubmitError(null);try{await post('/attendance-policy/evaluate-month',{month},{loadingMessage:`Recalculating ${month} attendance…`,successMessage:`Attendance recalculated for ${month}`})}catch(err){setSubmitError(err)}}

 return <div className="nexus-page attendance-rules-v4">
   <section className="directory-hero premium-hero page-intro"><div><small>POLICY ENGINE</small><h1>Attendance Rules</h1><p>Set how late arrivals, early exits and short days are counted, and when loss of pay applies.</p></div></section>
   <ErrorBox error={error||submitError}/>

   <section className="attendance-policy-summary"><article><span>Monthly combined quota</span><b>{quota} events</b><small>Late-in + early-leave together</small></article><article><span>Late grace window</span><b>{form.lateGraceMinutes} min</b><small>Arriving inside it is on time</small></article><article><span>Early tolerance</span><b>{form.earlyLeaveAllowedMinutes} min</b><small>Leaving inside it is not early</small></article><article><span>After quota</span><b>{form.lateLopAfterGraceDays} LOP</b><small>Per later exception</small></article><article><span>Early half-day</span><b>{form.earlyLeaveHalfDayAfterMinutes} min</b><small>Hard threshold</small></article></section>

   <div className="rules-layout v4"><main>
     <section className="premium-section-card"><div className="premium-section-head"><div><small>CORE POLICY</small><h2>How attendance is evaluated</h2><p>The order below is the same order used by the backend.</p></div></div><form onSubmit={save} className="policy-step-list">
       <article className="policy-step"><span className="policy-step-number">1</span><div className="policy-step-copy"><b>Company clock</b><p>Shift times are local HRMS times. India should remain UTC+05:30 / 330 minutes.</p></div><Field label="UTC offset minutes"><input type="number" value={form.timezoneOffsetMinutes??330} onChange={(e)=>set('timezoneOffsetMinutes',Number(e.target.value))}/></Field></article>
       <article className="policy-step important"><span className="policy-step-number">2</span><div className="policy-step-copy"><b>Combined monthly exception quota</b><p>Every late-in or early-leave event consumes one counter. The first {quota} events have no LOP. A late on the 1st of the month must therefore not automatically become half day.</p></div><Field label="Events per month"><input type="number" min="0" value={quota} onChange={(e)=>setQuota(e.target.value)}/></Field></article>
       <article className="policy-step"><span className="policy-step-number">3</span><div className="policy-step-copy"><b>Late-in handling</b><p>Arriving inside the grace is on time: with a 10:00 shift and 15 minutes, 10:14:59 is on time and 10:15:00 is the first late arrival. Only a late arrival after the grace uses the monthly counter. The shift's own grace counts too: the larger of the two applies. A normal late does not become HALF DAY simply because worked minutes are slightly below the full-day target.</p></div><div className="policy-step-fields"><Field label="Grace minutes"><input type="number" value={form.lateGraceMinutes||0} onChange={(e)=>set('lateGraceMinutes',Number(e.target.value))}/></Field><Field label="LOP after quota"><input type="number" step="0.5" value={form.lateLopAfterGraceDays||0} onChange={(e)=>set('lateLopAfterGraceDays',Number(e.target.value))}/></Field></div></article>
       <article className="policy-step"><span className="policy-step-number">4</span><div className="policy-step-copy"><b>Early-leave handling</b><p>Leaving within the tolerance before shift end is not early. Early leave beyond it uses the same combined counter. Only crossing the hard threshold below charges a half day.</p></div><div className="policy-step-fields"><Field label="Tolerance minutes"><input type="number" value={form.earlyLeaveAllowedMinutes||0} onChange={(e)=>set('earlyLeaveAllowedMinutes',Number(e.target.value))}/></Field><Field label="Half-day after"><input type="number" value={form.earlyLeaveHalfDayAfterMinutes||0} onChange={(e)=>set('earlyLeaveHalfDayAfterMinutes',Number(e.target.value))}/></Field><Field label="Half-day LOP"><input type="number" step="0.5" value={form.earlyLeaveLopDays||0} onChange={(e)=>set('earlyLeaveLopDays',Number(e.target.value))}/></Field></div></article>
       <article className="policy-step"><span className="policy-step-number">5</span><div className="policy-step-copy"><b>Very short days</b><p>A punch pair shorter than the shift's half-day minimum (for example 3 hours on a 9-hour shift). <b>Half day</b> keeps the current behaviour; <b>Absent</b> is the stricter rule most companies use, so a quick in-and-out never earns half a day's pay.</p></div><div className="policy-step-fields"><Field label="Short day counts as"><select value={form.belowHalfDayStatus||'HALF_DAY'} onChange={(e)=>set('belowHalfDayStatus',e.target.value)}><option value="HALF_DAY">Half day (0.5 LOP)</option><option value="ABSENT">Absent (1 LOP)</option></select></Field></div></article>
       <article className="policy-step"><span className="policy-step-number">6</span><div className="policy-step-copy"><b>Missing out time</b><p>A past day with only one punch is never loss of pay on its own. It shows in yellow on the attendance calendar until HR / admin decides there: set the real time, or count the day as present, half day or absent. A forgotten punch closes automatically {form.autoCloseOpenPunchAfterMinutes ?? 180} minutes after the shift ends.</p></div></article>
       <article className="policy-step"><span className="policy-step-number">7</span><div className="policy-step-copy"><b>Medical / special approval</b><p>Exceptional approved cases remain auditable and can protect the event from normal deduction.</p></div><label className="switch-row compact-switch"><input type="checkbox" checked={form.medicalSpecialRequiresHr!==false} onChange={(e)=>set('medicalSpecialRequiresHr',e.target.checked)}/><span><b>HR approval required</b><small>For medical and special exceptions.</small></span></label></article>
       {canManage&&<button className="primary rules-save-v4">Save attendance policy</button>}
     </form></section>

     {canManage&&<details className="premium-collapsible"><summary><div><small>ADVANCED</small><b>Custom deduction rules</b><span>Closed by default. Use only for exceptional company-specific rules.</span></div><em>{form.customRules?.length||0} rules</em></summary><div className="collapsible-body"><div className="custom-rule-builder"><Field label="Rule name"><input value={custom.name} onChange={(e)=>setCustom({...custom,name:e.target.value})} placeholder="Example: More than 30m late"/></Field><Field label="Condition"><select value={custom.condition} onChange={(e)=>setCustom({...custom,condition:e.target.value})}><option>LATE_IN_MINUTES_GT</option><option>EARLY_LEAVE_MINUTES_GT</option><option>HALF_DAY</option><option>MANUAL</option></select></Field><Field label="Threshold"><input type="number" value={custom.thresholdMinutes} onChange={(e)=>setCustom({...custom,thresholdMinutes:Number(e.target.value)})}/></Field><Field label="LOP"><input type="number" step="0.5" value={custom.lopDays} onChange={(e)=>setCustom({...custom,lopDays:Number(e.target.value)})}/></Field><button onClick={addCustom}>Add rule</button></div>{!(form.customRules||[]).length?<Empty>No custom rules. Core policy will be used.</Empty>:<div className="custom-rule-list">{form.customRules.map((r,i)=><article key={`${r.name}-${i}`}><div><b>{r.name}</b><span>{r.condition} · {r.thresholdMinutes} min → {r.lopDays} LOP</span></div><button onClick={()=>setForm((f)=>({...f,customRules:f.customRules.filter((_,x)=>x!==i)}))}>Remove</button></article>)}</div>}</div></details>}
   </main>

   <aside className="rule-side-stack"><section className="premium-section-card simulator-card"><div className="premium-section-head"><div><small>TEST BEFORE SAVING</small><h2>Rule simulator</h2></div></div><div className="simulator-fields"><Field label="Late minutes"><input type="number" value={sim.late} onChange={(e)=>setSim({...sim,late:Number(e.target.value)})}/></Field><Field label="Early leave minutes"><input type="number" value={sim.early} onChange={(e)=>setSim({...sim,early:Number(e.target.value)})}/></Field><Field label="Exception number this month"><input type="number" min="1" value={sim.instance} onChange={(e)=>setSim({...sim,instance:Number(e.target.value)})}/></Field><label className="switch-row compact-switch"><input type="checkbox" checked={sim.permission} onChange={(e)=>setSim({...sim,permission:e.target.checked})}/><span><b>Medical / special approved</b></span></label></div><div className={`simulation-result v4 ${simulation.tone}`}><small>PREVIEW RESULT</small><b>{simulation.result}</b><p>{simulation.detail}</p></div></section>
     {canEvaluate&&<section className="premium-section-card"><div className="premium-section-head"><div><small>REPROCESS</small><h2>Recalculate stored attendance</h2></div></div><Field label="Month"><input type="month" value={month} onChange={(e)=>setMonth(e.target.value)}/></Field><p className="muted small">Use after changing the rule. Existing attendance records for that month are evaluated again in date order.</p><button onClick={evaluate}>Recalculate {month}</button></section>}
   </aside></div>
 </div>;
}
