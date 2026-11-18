import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Empty, ErrorBox, Field } from '../components/Ui.jsx';
import { post, remove } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';

const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmt=(d)=>new Date(d).toLocaleDateString([],{day:'2-digit',month:'short',year:'numeric'});
const day=(d)=>new Date(d).toLocaleDateString([],{weekday:'short'}).toUpperCase();

export default function Holidays() {
  const { user } = useAuth();
  const canManageHolidays = hasAbility(user, 'HOLIDAYS', 'MANAGE');
  const [year, setYear] = useState(new Date().getFullYear());
  const [repairing, setRepairing] = useState(false);
  // Older versions stored some holidays at IST midnight (the previous day in UTC).
  // The app reads both correctly; this re-saves them in the canonical form.
  async function repairDates() {
    setRepairing(true);
    try {
      const r = await post('/holidays/repair-dates', {}, { loadingMessage: 'Checking holiday dates…', successMessage: false, toast: false });
      toast.success(r.fixed ? `${r.fixed} of ${r.checked} holiday dates re-saved on the correct day` : `All ${r.checked} holiday dates are already correct`);
      reload?.();
    } catch (err) { toast.error(err.message); } finally { setRepairing(false); }
  }
  const { data, error, reload } = useApi(`/holidays?year=${year}`, [year]);
  const [form, setForm] = useState({ name: '', date: '', location: 'ALL', optional: false });
  const [submitError, setSubmitError] = useState(null);
  const holidays=data?.holidays||[];
  const grouped=useMemo(()=>holidays.reduce((acc,h)=>{const m=new Date(h.date).getMonth();(acc[m] ||= []).push(h);return acc},{}),[holidays]);

  async function create(e) {
    e.preventDefault(); setSubmitError(null);
    try { await post('/holidays', form,{loadingMessage:'Adding holiday…',successMessage:`${form.name} added to holiday calendar`}); setForm({ name: '', date: '', location: 'ALL', optional: false }); reload(); } catch (err) { setSubmitError(err); }
  }
  async function deleteHoliday(id) {
    if (!window.confirm('Delete this holiday?')) return;
    setSubmitError(null);
    try { await remove(`/holidays/${id}`,{loadingMessage:'Removing holiday…',successMessage:'Holiday removed'}); reload(); } catch (err) { setSubmitError(err); }
  }

  return <div className="nexus-page holidays-v24">
    <section className="directory-hero premium-hero page-intro"><div><small>WORKING CALENDAR</small><h1>Holiday Planner</h1><p>Company holidays for the office and the factory. Add a date once and everyone's attendance and payroll use it.</p></div><div className="hero-actions">{canManageHolidays&&<button type="button" className="secondary" title="Re-pins holidays saved by older versions to the right calendar day" onClick={repairDates} disabled={repairing}>{repairing?'Checking…':'Check saved dates'}</button>}<Field label="Calendar year"><select value={year} onChange={(e)=>setYear(Number(e.target.value))}>{[year-1,year,year+1].filter((v,i,a)=>a.indexOf(v)===i).map((y)=><option key={y}>{y}</option>)}</select></Field></div></section>
    <ErrorBox error={error || submitError} />

    <div className="holiday-dashboard-grid">
      {canManageHolidays&&<section className="premium-section-card holiday-add-card"><div className="premium-section-head"><div><small>ADD DATE</small><h2>New holiday</h2><p>Choose audience and optional status.</p></div></div><form onSubmit={create}><Field label="Holiday name"><input value={form.name} onChange={(e)=>setForm((f)=>({...f,name:e.target.value}))} required placeholder="Example: Republic Day"/></Field><div className="drawer-two-col"><Field label="Date"><input type="date" value={form.date} onChange={(e)=>setForm((f)=>({...f,date:e.target.value}))} required/></Field><Field label="Applies to"><select value={form.location} onChange={(e)=>setForm((f)=>({...f,location:e.target.value}))}><option value="ALL">Office + Factory</option><option value="OFFICE">Office only</option><option value="FACTORY">Factory only</option></select></Field></div><label className="switch-row compact-switch"><input type="checkbox" checked={form.optional} onChange={(e)=>setForm((f)=>({...f,optional:e.target.checked}))}/><span><b>Optional holiday</b><small>Employees may choose based on policy.</small></span></label><button className="primary">Add to calendar</button></form></section>}
      <section className="premium-section-card holiday-year-summary"><div className="premium-section-head"><div><small>{year}</small><h2>Calendar summary</h2></div></div><div className="holiday-summary-stats"><div><span>Total holidays</span><b>{holidays.length}</b></div><div><span>Office</span><b>{holidays.filter((h)=>['ALL','OFFICE'].includes(h.location)).length}</b></div><div><span>Factory</span><b>{holidays.filter((h)=>['ALL','FACTORY'].includes(h.location)).length}</b></div><div><span>Optional</span><b>{holidays.filter((h)=>h.optional).length}</b></div></div><div className="holiday-next"><span>Next holiday</span>{holidays.filter((h)=>new Date(h.date)>=new Date()).sort((a,b)=>new Date(a.date)-new Date(b.date))[0] ? <b>{holidays.filter((h)=>new Date(h.date)>=new Date()).sort((a,b)=>new Date(a.date)-new Date(b.date))[0].name} · {fmt(holidays.filter((h)=>new Date(h.date)>=new Date()).sort((a,b)=>new Date(a.date)-new Date(b.date))[0].date)}</b> : <b>No upcoming holiday in {year}</b>}</div></section>
    </div>

    <section className="premium-section-card holiday-list-card"><div className="premium-section-head"><div><small>ANNUAL VIEW</small><h2>{year} holidays</h2><p>Grouped month by month for quick scanning.</p></div><span>{holidays.length} dates</span></div>{!holidays.length?<Empty>No holidays configured for {year}.</Empty>:<div className="holiday-month-groups">{Object.keys(grouped).sort((a,b)=>Number(a)-Number(b)).map((m)=><section key={m}><div className="holiday-month-label"><b>{monthNames[Number(m)]}</b><span>{grouped[m].length}</span></div><div className="holiday-cards">{grouped[m].map((h)=><article key={h._id}><div className="holiday-date-badge"><small>{day(h.date)}</small><b>{new Date(h.date).getDate()}</b></div><div className="holiday-card-copy"><b>{h.name}</b><small>{fmt(h.date)}</small></div><div className="holiday-card-tags"><span>{h.location==='ALL'?'Office + Factory':h.location}</span>{h.optional&&<span className="optional">Optional</span>}</div>{canManageHolidays&&<button className="danger-text" onClick={()=>deleteHoliday(h._id)}>Remove</button>}</article>)}</div></section>)}</div>}</section>
  </div>;
}
