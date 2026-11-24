import { currentMonthKey } from '../utils/time.js';
import React, { useMemo, useState } from 'react';
import { Empty, ErrorBox, Field } from '../components/Ui.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';
import ShiftPicker from '../components/ShiftPicker.jsx';
import { searchShifts, rememberShift } from '../utils/shiftSearch.js';

const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const LIBRARY_PREVIEW = 12;
const monthRange = (month) => {
  const [y,m] = month.split('-').map(Number);
  return { from:`${month}-01`, to:`${month}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}` };
};
const initials = (e) => `${e.firstName?.[0]||''}${e.lastName?.[0]||''}`.toUpperCase();
const formatMinutes = (minutes) => {
  const n = Number(minutes || 0);
  if (!n) return '—';
  const h = Math.floor(n / 60); const m = n % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

export default function Shifts(){
  const { user } = useAuth();
  const canManage = hasAbility(user,'SHIFTS','MANAGE');
  const { data: shiftData, error: shiftError, reload: reloadShifts } = useApi('/shifts',[]);
  const { data: employeeData, error: employeeError } = useApi('/employees',[]);
  const shifts = shiftData?.shifts || [];
  const employees = (employeeData?.employees || []).filter((e) => e.status !== 'OFFBOARDED');
  const currentMonth = currentMonthKey();
  const range = monthRange(currentMonth);
  const [section,setSection] = useState('OFFICE');
  const [month,setMonth] = useState(currentMonth);
  const [search,setSearch] = useState('');
  const [selected,setSelected] = useState([]);
  const [assign,setAssign] = useState({shiftId:'',fromDate:range.from,toDate:range.to,weekdays:[],recalculateAttendance:true,forceRecalculate:false});
  const [create,setCreate] = useState({name:'',code:'',startTime:'09:30',endTime:'18:30',graceMinutes:15,fullDayMinutes:480,halfDayMinutes:240,weeklyOffDays:[0]});
  const [error,setError] = useState(null);
  const [showCreate,setShowCreate] = useState(false);
  const [libraryQuery,setLibraryQuery] = useState('');
  const [showAllShifts,setShowAllShifts] = useState(false);
  const activeShifts = useMemo(() => shifts.filter((s)=>s.active!==false), [shifts]);
  const libraryShifts = useMemo(() => searchShifts(shifts, libraryQuery), [shifts, libraryQuery]);
  const libraryCards = libraryQuery || showAllShifts ? libraryShifts : libraryShifts.slice(0, LIBRARY_PREVIEW);

  const visible = useMemo(() => employees.filter((e) =>
    (section==='ALL' || e.workLocation===section || e.workLocation==='BOTH') &&
    `${e.employeeCode} ${e.firstName} ${e.lastName||''} ${e.department||''}`.toLowerCase().includes(search.toLowerCase())
  ), [employees,section,search]);
  const grouped = section === 'ALL'
    ? {
        OFFICE: visible.filter((e)=>e.workLocation==='OFFICE'),
        FACTORY: visible.filter((e)=>e.workLocation==='FACTORY'),
        BOTH: visible.filter((e)=>e.workLocation==='BOTH')
      }
    : { [section]: visible };
  const selectedShift = shifts.find((s)=>s._id===assign.shiftId);

  function changeMonth(value){ setMonth(value); const r=monthRange(value); setAssign((a)=>({...a,fromDate:r.from,toDate:r.to})); }
  function toggle(id){ setSelected((s)=>s.includes(id)?s.filter((x)=>x!==id):[...s,id]); }
  function selectVisible(){ setSelected((s)=>Array.from(new Set([...s,...visible.map((e)=>e._id)]))); }
  function toggleDay(d){ setAssign((a)=>({...a,weekdays:a.weekdays.includes(d)?a.weekdays.filter((x)=>x!==d):[...a.weekdays,d]})); }
  function presetSaturday(){
    const sat = shifts.find((s)=>/saturday|half.?day/i.test(`${s.name} ${s.code||''}`));
    setSection('OFFICE');
    setAssign((a)=>({...a,weekdays:[6],shiftId:sat?._id||a.shiftId}));
  }
  async function assignShift(e){
    e.preventDefault(); setError(null);
    try {
      await post('/shifts/assign',{...assign,employeeIds:selected},{loadingMessage:'Assigning shift…',successMessage:`Shift assigned to ${selected.length} employee${selected.length===1?'':'s'}`});
    } catch(err){ setError(err); }
  }
  async function createShift(e){
    e.preventDefault(); setError(null);
    try {
      await post('/shifts',create,{loadingMessage:'Creating shift template…',successMessage:`${create.name || 'Shift'} created successfully`});
      setShowCreate(false); reloadShifts();
    } catch(err){ setError(err); }
  }

  return <div className="nexus-page shifts-v4">
    <section className="directory-hero premium-hero page-intro"><div><small>WORKFORCE SCHEDULING</small><h1>Shift Planner</h1><p>Create shift timings and assign them to people for any dates, in bulk.</p></div><div className="hero-actions">{canManage&&<button className="primary" onClick={()=>setShowCreate(true)}>+ Create shift</button>}</div></section>
    <ErrorBox error={error||shiftError||employeeError}/>

    <section className="shift-template-showcase">
      <div className="section-heading-row"><div><small>SHIFT LIBRARY</small><h2>Your shift templates</h2><p>Pick any template below when building an assignment.</p></div><span>{libraryQuery?`${libraryShifts.length} of ${shifts.length}`:`${shifts.length} template${shifts.length===1?'':'s'}`}</span></div>
      {shifts.length>0&&<div className="shift-library-find"><input type="search" placeholder="Find a shift: name, code or time (F12, 9:30, 8-5, sat off) · Enter picks the first" value={libraryQuery} onChange={(e)=>setLibraryQuery(e.target.value)} onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); const first=libraryShifts[0]; if(first){ setAssign((a)=>({...a,shiftId:first._id})); rememberShift(first._id); } } if(e.key==='Escape') setLibraryQuery(''); }} aria-label="Find a shift"/>{!libraryQuery&&shifts.length>LIBRARY_PREVIEW&&<button type="button" onClick={()=>setShowAllShifts((v)=>!v)}>{showAllShifts?'Show fewer':`Show all ${shifts.length}`}</button>}</div>}
      {!shifts.length ? <Empty>No shift templates yet.</Empty> : !libraryShifts.length ? <Empty>No shift matches “{libraryQuery}”.</Empty> : <div className="shift-template-cards">{libraryCards.map((s)=><button type="button" key={s._id} className={`shift-template-card ${assign.shiftId===s._id?'selected':''}`} onClick={()=>{ setAssign((a)=>({...a,shiftId:s._id})); rememberShift(s._id); }}>
        <div className="shift-template-icon">◷</div>
        <div className="shift-template-copy"><div className="shift-template-title"><b>{s.name}</b><span>{s.code||'SHIFT'}</span></div><strong>{s.startTime} <i>→</i> {s.endTime}</strong><div className="shift-template-meta"><span>{s.graceMinutes||0}m grace</span><span>{formatMinutes(s.fullDayMinutes)} full</span><span>{formatMinutes(s.halfDayMinutes)} half</span></div></div>
        {assign.shiftId===s._id&&<em>Selected ✓</em>}
      </button>)}</div>}
    </section>

    {canManage&&<div className="shift-planner-shell v4">
      <section className="shift-people-panel">
        <header><div><small>STEP 1</small><h2>Select people</h2><p>Only active employees from the Employee Directory are shown.</p></div><b className="selection-count">{selected.length} selected</b></header>
        <div className="segmented shift-section-segment"><button className={section==='ALL'?'active':''} onClick={()=>setSection('ALL')}>All</button><button className={section==='OFFICE'?'active':''} onClick={()=>setSection('OFFICE')}>Office</button><button className={section==='FACTORY'?'active':''} onClick={()=>setSection('FACTORY')}>Factory</button></div>
        <input className="people-search" placeholder="Search employee, code or department" value={search} onChange={(e)=>setSearch(e.target.value)}/>
        <div className="select-bar"><button type="button" onClick={selectVisible}>Select visible · {visible.length}</button><button type="button" onClick={()=>setSelected([])}>Clear</button></div>
        <div className="grouped-employee-list v4">{Object.entries(grouped).map(([group,rows])=>rows.length?<section key={group}><div className="employee-group-title"><b>{group}</b><span>{rows.length}</span></div>{rows.map((emp)=><label key={emp._id} className={selected.includes(emp._id)?'selected':''}><input type="checkbox" checked={selected.includes(emp._id)} onChange={()=>toggle(emp._id)}/><span className="employee-mini-avatar">{initials(emp)}</span><span className="employee-select-copy"><b>{emp.firstName} {emp.lastName||''}</b><small>{emp.employeeCode} · {emp.department||'Department'}</small></span><span className="employee-location-pill">{emp.workLocation||'FACTORY'}</span></label>)}</section>:null)}</div>
      </section>

      <section className="shift-assignment-panel"><header><div><small>STEP 2</small><h2>Build assignment</h2><p>Preview the exact employees, dates and shift before saving.</p></div></header><form onSubmit={assignShift}>
        <div className="drawer-two-col"><Field label="Month"><input type="month" value={month} onChange={(e)=>changeMonth(e.target.value)}/></Field><div className="field"><span id="assign-shift-label">Shift</span><ShiftPicker shifts={activeShifts} value={assign.shiftId} onChange={(id)=>setAssign((a)=>({...a,shiftId:id}))} loading={!shiftData} labelledBy="assign-shift-label" id="assign-shift"/></div></div>
        <div className="weekday-card"><div className="weekday-card-head"><div><b>Repeat on selected weekdays</b><small>Choose Saturday once and every Saturday inside the range is assigned automatically.</small></div></div><div className="weekday-pills">{weekdays.map((label,d)=><button type="button" key={label} className={assign.weekdays.includes(d)?'active':''} onClick={()=>toggleDay(d)}>{label}</button>)}</div><button type="button" className="saturday-preset" onClick={presetSaturday}><span>Sat</span><div><b>Office Saturday half-day</b><small>Select every Saturday in this month with one click.</small></div></button></div>
        <div className="drawer-two-col"><Field label="From"><input type="date" value={assign.fromDate} onChange={(e)=>setAssign({...assign,fromDate:e.target.value})}/></Field><Field label="To"><input type="date" value={assign.toDate} onChange={(e)=>setAssign({...assign,toDate:e.target.value})}/></Field></div>
        <label className="switch-row compact-switch"><input type="checkbox" checked={assign.recalculateAttendance} onChange={(e)=>setAssign({...assign,recalculateAttendance:e.target.checked})}/><span><b>Recalculate attendance</b><small>Recommended when a historical shift is changed.</small></span></label>
        <div className="assignment-preview v4"><div><span>People</span><b>{selected.length}</b></div><div><span>Days</span><b>{assign.weekdays.length?assign.weekdays.map((d)=>weekdays[d]).join(', '):'All days'}</b></div><div><span>Shift</span><b>{selectedShift?`${selectedShift.startTime}–${selectedShift.endTime}`:'Not selected'}</b></div></div>
        <button className="primary planner-submit" disabled={!selected.length||!assign.shiftId}>Assign shift to {selected.length} employee{selected.length===1?'':'s'}</button>
      </form></section>
    </div>}

    {canManage&&showCreate&&<div className="side-drawer-backdrop" onClick={()=>setShowCreate(false)}><aside className="side-drawer shift-create-drawer" onClick={(e)=>e.stopPropagation()}><div className="drawer-head"><div><small>SHIFT TEMPLATE</small><h2>Create a shift</h2><p>Save once, reuse for Office or Factory assignments.</p></div><button className="icon-close" onClick={()=>setShowCreate(false)}>×</button></div><form className="drawer-form" onSubmit={createShift}><Field label="Shift name"><input required value={create.name} onChange={(e)=>setCreate({...create,name:e.target.value})} placeholder="Office Full Day"/></Field><Field label="Code"><input value={create.code} onChange={(e)=>setCreate({...create,code:e.target.value})} placeholder="OFFICE-FULL"/></Field><div className="drawer-two-col"><Field label="Starts"><input type="time" value={create.startTime} onChange={(e)=>setCreate({...create,startTime:e.target.value})}/></Field><Field label="Ends"><input type="time" value={create.endTime} onChange={(e)=>setCreate({...create,endTime:e.target.value})}/></Field></div><div className="drawer-two-col"><Field label="Grace minutes"><input type="number" value={create.graceMinutes} onChange={(e)=>setCreate({...create,graceMinutes:Number(e.target.value)})}/></Field><Field label="Half-day minutes"><input type="number" value={create.halfDayMinutes} onChange={(e)=>setCreate({...create,halfDayMinutes:Number(e.target.value)})}/></Field></div><Field label="Full-day minutes"><input type="number" value={create.fullDayMinutes} onChange={(e)=>setCreate({...create,fullDayMinutes:Number(e.target.value)})}/></Field><button className="primary drawer-primary">Create shift template</button></form></aside></div>}
  </div>;
}
