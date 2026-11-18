import React,{useMemo,useState}from'react';
import { formatDate } from '../utils/time.js';
import { AiButton } from '../components/AiKit.jsx';
import '../styles/attendance.css';
import '../styles/v26.css';
import{Empty,ErrorBox,Field}from'../components/Ui.jsx';
import{post,remove}from'../api/client.js';
import{useApi}from'../hooks/useApi.js';
import{useAuth}from'../state/AuthContext.jsx';
import{hasAbility}from'../utils/permissions.js';

const toDataUrl=file=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(file)});
const isImage=(mime='')=>String(mime).startsWith('image/');
const isPdf=(mime='',name='')=>String(mime).includes('pdf')||String(name).toLowerCase().endsWith('.pdf');
const initials=(name='HR')=>String(name).split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();

function AttachmentPreview({url,mimeType,fileName,compact=false}){
  if(!url)return null;
  if(isImage(mimeType)) return <a className={`notice-visual-preview image ${compact?'compact':''}`} href={url} target="_blank" rel="noreferrer"><img src={url} loading="lazy" alt={fileName||'Notice attachment'}/><span>Open image ↗</span></a>;
  if(isPdf(mimeType,fileName)) return <div className={`notice-visual-preview pdf ${compact?'compact':''}`}><iframe title={fileName||'Notice PDF'} src={`${url}#toolbar=0&navpanes=0&view=FitH`}/><a href={url} target="_blank" rel="noreferrer"><b>PDF</b><span>{fileName||'Notice document'}</span><em>Open ↗</em></a></div>;
  return <a className="notice-file-card" href={url} target="_blank" rel="noreferrer"><span>DOC</span><div><b>{fileName||'Attachment'}</b><small>Preview is not available for this file type.</small></div><em>Open ↗</em></a>;
}

export default function Notices(){
  const{user}=useAuth();
  const canManage=hasAbility(user,'NOTICES','MANAGE');
  const{data,error,reload}=useApi('/notices',[]);
  const{data:employeeData}=useApi(canManage?'/employees':'',[canManage]);
  const employees=(employeeData?.employees||[]).filter((e)=>e.status!=='OFFBOARDED');
  const[drawer,setDrawer]=useState(false);
  const[scope,setScope]=useState('BOTH');
  const[search,setSearch]=useState('');
  const[form,setForm]=useState({title:'',body:'',audienceLocations:['OFFICE','FACTORY'],employeeIds:[],pinned:false,expiresAt:'',dataUrl:'',fileName:'',mimeType:''});
  const[submitError,setSubmitError]=useState(null);
  const[aiBrief,setAiBrief]=useState('');
  const[delivery,setDelivery]=useState({email:true,whatsapp:false});
  const allowedModes=data?.publishingScope?.allowedModes||['BOTH','OFFICE','FACTORY','SELECTED'];
  const visibleEmployees=useMemo(()=>employees.filter((e)=>`${e.employeeCode} ${e.firstName} ${e.lastName||''} ${e.department||''}`.toLowerCase().includes(search.toLowerCase())),[employees,search]);
  function changeScope(next){setScope(next);setForm((f)=>({...f,audienceLocations:next==='BOTH'?['OFFICE','FACTORY']:next==='OFFICE'?['OFFICE']:next==='FACTORY'?['FACTORY']:[],employeeIds:next==='SELECTED'?f.employeeIds:[]}))}
  function openPublisher(){const next=allowedModes.includes('BOTH')?'BOTH':allowedModes[0]||'SELECTED';changeScope(next);setDrawer(true)}
  function toggleEmployee(id){setForm((f)=>({...f,employeeIds:f.employeeIds.includes(id)?f.employeeIds.filter((x)=>x!==id):[...f.employeeIds,id]}))}
  async function file(e){const selected=e.target.files?.[0];if(!selected)return;const dataUrl=await toDataUrl(selected);setForm((f)=>({...f,fileName:selected.name,mimeType:selected.type,dataUrl}))}
  async function publish(e){e.preventDefault();setSubmitError(null);try{await post('/notices',{...form,delivery:{notify:true,email:delivery.email,whatsapp:delivery.whatsapp}},{loadingMessage:'Publishing notice…',successMessage:'Notice published successfully'});setForm({title:'',body:'',audienceLocations:['OFFICE','FACTORY'],employeeIds:[],pinned:false,expiresAt:'',dataUrl:'',fileName:'',mimeType:''});setScope('BOTH');setDrawer(false);reload()}catch(err){setSubmitError(err)}}

  return <div className="nexus-page notices-v4">
    <section className="directory-hero premium-hero page-intro"><div><small>PEOPLE COMMUNICATION</small><h1>Notice Board</h1><p>Company announcements. Choose who sees each notice and whether it also goes out by email or WhatsApp.</p></div><div className="hero-actions">{canManage&&<button className="primary" onClick={openPublisher}>+ Publish notice</button>}<span className={`storage-badge ${data?.storage?.cloudinary?'connected':'warning'}`}>{data?.storage?.cloudinary?'● Cloudinary connected':'○ Cloudinary not configured'}</span></div></section>
    <ErrorBox error={error||submitError}/>
    {!data?.storage?.cloudinary&&canManage&&<div className="config-warning"><b>Cloudinary configuration needed</b><span>Add the Cloudinary environment keys on the server. Attachments can still use the fallback until then.</span></div>}

    <div className="notice-wall">{!(data?.notices||[]).length?<Empty>No notices have been published.</Empty>:data.notices.map((n)=><article className={`premium-notice-card ${n.pinned?'pinned':''}`} key={n._id}>
      <div className="notice-card-top"><div className="notice-author"><span>{initials(n.publishedBy?.name||'HR')}</span><div><b>{n.publishedBy?.name||'HR Team'}</b><small>{new Date(n.createdAt).toLocaleDateString([],{day:'2-digit',month:'short',year:'numeric'})}</small></div></div><div className="notice-top-tags">{n.pinned&&<span className="pin-chip">Pinned</span>}<span className="notice-audience">{n.employeeIds?.length?`${n.employeeIds.length} selected`:(n.audienceLocations||[]).join(' + ')||'Everyone'}</span></div></div>
      <div className="notice-copy"><h2>{n.title}</h2>{n.body&&<p>{n.body}</p>}</div>
      {n.url&&<AttachmentPreview url={n.url} mimeType={n.mimeType} fileName={n.fileName}/>} 
      <footer><span>{n.expiresAt?`Expires ${formatDate(n.expiresAt)}`:'Visible until removed'}</span>{canManage&&(['SUPER_ADMIN','HR_ADMIN'].includes(String(user?.role||'').toUpperCase())||String(n.publishedBy?._id||'')===String(user?._id||''))&&<button className="danger-text" onClick={async()=>{if(window.confirm('Remove this notice?')){try{await remove(`/notices/${n._id}`,{loadingMessage:'Removing notice…',successMessage:'Notice removed'});reload()}catch(err){setSubmitError(err)}}}}>Remove</button>}</footer>
    </article>)}</div>

    {drawer&&<div className="side-drawer-backdrop" onClick={()=>setDrawer(false)}><aside className="side-drawer notice-drawer notice-drawer-v4" onClick={(e)=>e.stopPropagation()}><div className="drawer-head"><div><small>PUBLISH</small><h2>New notice</h2><p>Employees will see only notices inside their audience scope.</p></div><button className="icon-close" onClick={()=>setDrawer(false)}>×</button></div><form className="drawer-form" onSubmit={publish}>
      <div className="notice-ai-row"><input value={aiBrief} onChange={(e)=>setAiBrief(e.target.value)} placeholder="Tell Gemini what to announce, e.g. canteen closed Friday for cleaning"/><AiButton small endpoint="/ai/notices/draft" body={()=>({brief:aiBrief,audience:scope==='FACTORY'?'factory workers':scope==='OFFICE'?'office staff':'all employees'})} disabled={!aiBrief.trim()} label="Draft notice" onResult={(r)=>setForm((f)=>({...f,title:r.data?.title||f.title,body:r.data?.body||f.body}))}/></div>
      <Field label="Title"><input required value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})} placeholder="Short, clear notice title"/></Field>
      <Field label="Message"><textarea rows="4" value={form.body} onChange={(e)=>setForm({...form,body:e.target.value})} placeholder="What does the audience need to know?"/></Field>
      <div className="notice-ai-row compact"><AiButton small endpoint="/ai/translate" body={()=>({text:form.body,target:'hi'})} disabled={!form.body.trim()} label="Add Hindi" onResult={(r)=>setForm((f)=>({...f,body:`${f.body}\n\n${r.text}`}))}/><AiButton small endpoint="/ai/translate" body={()=>({text:form.body,target:'bn'})} disabled={!form.body.trim()} label="Add Bengali" onResult={(r)=>setForm((f)=>({...f,body:`${f.body}\n\n${r.text}`}))}/><AiButton small endpoint="/ai/polish" body={()=>({text:form.body,purpose:'NOTICE'})} disabled={!form.body.trim()} label="Polish" onResult={(r)=>setForm((f)=>({...f,body:r.text}))}/></div>
      <div className="notice-delivery"><span>Also send</span><label><input type="checkbox" checked={delivery.email} onChange={(e)=>setDelivery((d)=>({...d,email:e.target.checked}))}/> Email</label><label><input type="checkbox" checked={delivery.whatsapp} onChange={(e)=>setDelivery((d)=>({...d,whatsapp:e.target.checked}))}/> WhatsApp</label><small>Everyone in the audience also gets an in-app alert.</small></div>
      <div className="drawer-label">Audience</div><div className="scope-mode-grid compact">{[['BOTH','Office + Factory'],['OFFICE','Office only'],['FACTORY','Factory only'],['SELECTED','Selected people']].map(([v,l])=><button type="button" key={v} disabled={!allowedModes.includes(v)} className={scope===v?'active':''} onClick={()=>changeScope(v)}>{l}</button>)}</div>
      {scope==='SELECTED'&&<><input className="people-search" placeholder="Search employees" value={search} onChange={(e)=>setSearch(e.target.value)}/><div className="employee-checkbox-list premium-check-list">{visibleEmployees.map((emp)=><label key={emp._id} className="check compact"><input type="checkbox" checked={form.employeeIds.includes(emp._id)} onChange={()=>toggleEmployee(emp._id)}/><span>{emp.employeeCode} · {emp.firstName} {emp.lastName||''}<small>{emp.workLocation||'FACTORY'} · {emp.department||''}</small></span></label>)}</div></>}
      <Field label="Attachment"><input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={file}/></Field>
      {form.dataUrl&&<div className="notice-compose-preview"><div className="notice-preview-label"><b>Preview before publishing</b><button type="button" onClick={()=>setForm((f)=>({...f,dataUrl:'',fileName:'',mimeType:''}))}>Remove file</button></div><AttachmentPreview url={form.dataUrl} mimeType={form.mimeType} fileName={form.fileName} compact/></div>}
      <div className="drawer-two-col"><Field label="Expiry date (optional)"><input type="date" value={form.expiresAt} onChange={(e)=>setForm({...form,expiresAt:e.target.value})}/></Field><label className="switch-row compact-switch"><input type="checkbox" checked={form.pinned} onChange={(e)=>setForm({...form,pinned:e.target.checked})}/><span><b>Pin notice</b><small>Keep this above normal notices.</small></span></label></div>
      <button className="primary drawer-primary">Publish notice</button>
    </form></aside></div>}
  </div>;
}
