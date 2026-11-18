import React,{useEffect,useMemo,useState}from'react';
import{Empty,ErrorBox,Field}from'../components/Ui.jsx';
import{patch,post,remove}from'../api/client.js';
import{useApi}from'../hooks/useApi.js';

const MODULE_GROUPS=[
 ['People',[['EMPLOYEES',['READ','CREATE','UPDATE','DELETE','MANAGE_LOGIN']],['HIERARCHY',['READ','MANAGE']],['PROBATION',['READ','MANAGE','APPROVE']]]],
 ['Time & Leave',[['ATTENDANCE',['READ','IMPORT','OVERRIDE','EVALUATE','MANAGE']],['REGULARIZATION',['READ','APPLY_ON_BEHALF','APPROVE','MANAGE']],['LEAVE',['READ','APPLY_ON_BEHALF','APPROVE','MANAGE']],['SHIFTS',['READ','MANAGE']],['ATTENDANCE_RULES',['READ','APPROVE','MANAGE']]]],
 ['Payroll',[['PAYROLL',['READ','RUN','UPDATE_SALARY_MASTER','UPDATE_RULES','UPDATE_TEMPLATE','MANAGE']]]],
 ['System',[['BIOMETRIC',['READ','MANAGE','SYNC']],['NOTICES',['READ','CREATE','UPDATE','MANAGE']],['DOCUMENTS',['READ','CREATE','UPDATE','DELETE']],['COMPANY_SETTINGS',['READ','MANAGE']],['ACCESS',['READ','MANAGE','DELETE']],['AI',['READ','COMMAND']],['SYSTEM',['MANAGE']]]]
];
const DATA_RESOURCES=['ATTENDANCE','SALARY','EMPLOYEE_PROFILE','LEAVE'];
const normalize=(u)=>({allowAll:Boolean(u?.operationPermissions?.allowAll),modules:u?.operationPermissions?.modules||[]});
const hasAction=(p,m,a)=>Boolean((p.modules||[]).find((x)=>String(x.module).toUpperCase()===m)?.actions?.map((x)=>String(x).toUpperCase()).includes(a));
const initials=(u)=>`${u?.employee?.firstName?.[0]||u?.name?.[0]||'U'}${u?.employee?.lastName?.[0]||''}`.toUpperCase();
const displayName=(u)=>u?.employee ? `${u.employee.firstName||''} ${u.employee.lastName||''}`.trim() : (u?.name||u?.email||'User');
const pretty=(v)=>String(v||'').replaceAll('_',' ');

export default function AdminAccess(){
 const{data:usersData,error:usersError,reload:reloadUsers}=useApi('/employees/users',[]);
 const{data:employeesData,error:employeesError}=useApi('/employees',[]);
 const{data:grantsData,error:grantsError,reload:reloadGrants}=useApi('/employees/access-grants',[]);
 const users=usersData?.users||[];
 const employees=(employeesData?.employees||[]).filter((e)=>e.status!=='OFFBOARDED');
 const[selectedUserId,setSelectedUserId]=useState('');
 const selectedUser=useMemo(()=>users.find((u)=>u._id===selectedUserId),[users,selectedUserId]);
 const[query,setQuery]=useState('');
 const[role,setRole]=useState('EMPLOYEE');
 const[status,setStatus]=useState('ACTIVE');
 const[perms,setPerms]=useState({allowAll:false,modules:[]});
 const[scopeMode,setScopeMode]=useState('BOTH');
 const[dataGrant,setDataGrant]=useState({viewerUserId:'',resource:'ATTENDANCE',canViewAll:true,employeeIds:[],workLocations:['OFFICE','FACTORY'],notes:''});
 const[error,setError]=useState(null);

 useEffect(()=>{if(!selectedUserId&&users.length)setSelectedUserId(users[0]._id)},[users,selectedUserId]);
 useEffect(()=>{if(!selectedUser)return;setRole(selectedUser.role||'EMPLOYEE');setStatus(selectedUser.status||'ACTIVE');setPerms(normalize(selectedUser));setDataGrant((g)=>({...g,viewerUserId:selectedUser._id}))},[selectedUser]);
 const filtered=users.filter((u)=>`${displayName(u)} ${u.employee?.employeeCode||''} ${u.employee?.department||''} ${u.email||''} ${u.role||''}`.toLowerCase().includes(query.toLowerCase()));
 const scopedEmployees=employees.filter((e)=>scopeMode==='SELECTED'||scopeMode==='BOTH'||e.workLocation===scopeMode||e.workLocation==='BOTH');
 const enabledCount=(perms.modules||[]).reduce((sum,m)=>sum+(m.actions?.length||0),0);

 function toggleAction(moduleName,action){setPerms((p)=>{const modules=[...(p.modules||[])];let i=modules.findIndex((m)=>String(m.module).toUpperCase()===moduleName);if(i<0){modules.push({module:moduleName,actions:[]});i=modules.length-1}const a=new Set((modules[i].actions||[]).map((x)=>String(x).toUpperCase()));a.has(action)?a.delete(action):a.add(action);modules[i]={module:moduleName,actions:[...a]};return{...p,modules:modules.filter((m)=>m.actions.length)}})}
 function applyScope(mode){setScopeMode(mode);const workLocations=mode==='BOTH'?['OFFICE','FACTORY']:mode==='OFFICE'?['OFFICE']:mode==='FACTORY'?['FACTORY']:[];setDataGrant((g)=>({...g,canViewAll:mode!=='SELECTED',workLocations,employeeIds:mode==='SELECTED'?g.employeeIds:[]}))}
 function toggleEmployee(id){setDataGrant((g)=>({...g,employeeIds:g.employeeIds.includes(id)?g.employeeIds.filter((x)=>x!==id):[...g.employeeIds,id]}))}
 async function savePermissions(e){e.preventDefault();setError(null);try{await patch(`/employees/users/${selectedUserId}/permissions`,{role,status,operationPermissions:perms},{loadingMessage:'Saving access permissions…',successMessage:'Operation permissions saved'});reloadUsers()}catch(err){setError(err)}}
 async function saveScope(e){e.preventDefault();setError(null);try{await post('/employees/access-grants',dataGrant,{loadingMessage:'Saving visibility scope…',successMessage:'Employee visibility scope saved'});reloadGrants()}catch(err){setError(err)}}
 async function del(id){if(!window.confirm('Delete this visibility grant?'))return;try{await remove(`/employees/access-grants/${id}`);reloadGrants()}catch(err){setError(err)}}

 return <div className="nexus-page access-v4">
   <section className="directory-hero premium-hero page-intro"><div><small>ROLE BASED ACCESS CONTROL</small><h1>Access Control</h1><p>Choose what each person can see and do in the HRMS, and whose records they can open.</p></div></section>
   <ErrorBox error={error||usersError||employeesError||grantsError}/>
   <div className="admin-access-layout v4">
     <aside className="user-access-list v4"><div className="access-search-title"><div><small>PORTAL USERS</small><h2>Employees</h2></div><span>{users.length}</span></div><input placeholder="Search employee…" value={query} onChange={(e)=>setQuery(e.target.value)}/><div className="access-user-scroll">{filtered.map((u)=><button key={u._id} className={u._id===selectedUserId?'active':''} onClick={()=>setSelectedUserId(u._id)}><span className="avatar small-avatar">{initials(u)}</span><span><b>{displayName(u)}</b><small>{u.employee?.employeeCode||'No employee code'} · {u.employee?.department||'Department'}</small></span><em>{u.employee?.workLocation||'—'}</em></button>)}</div></aside>

     <main className="permission-workspace">
       <section className="access-profile-strip"><div className="access-profile-identity"><span className="avatar access-avatar">{initials(selectedUser)}</span><div><small>EDITING ACCESS FOR</small><h2>{displayName(selectedUser)}</h2><p>{selectedUser?.employee?.employeeCode||''} · {selectedUser?.employee?.designation||selectedUser?.role||''} · {selectedUser?.employee?.workLocation||''}</p></div></div><div className="access-profile-stats"><div><span>Status</span><b>{status}</b></div><div><span>Custom actions</span><b>{perms.allowAll?'ALL':enabledCount}</b></div></div></section>

       <section className="premium-section-card"><div className="premium-section-head"><div><small>OPERATIONS</small><h2>What this employee can do</h2><p>Permission groups stay collapsed until you need to edit them.</p></div></div><form onSubmit={savePermissions}>
         <div className="access-role-row"><Field label="Portal role"><select value={role} onChange={(e)=>setRole(e.target.value)}><option>EMPLOYEE</option><option>MANAGER</option><option>HR_ADMIN</option><option>SUPER_ADMIN</option></select></Field><Field label="Account status"><select value={status} onChange={(e)=>setStatus(e.target.value)}><option>ACTIVE</option><option>DISABLED</option></select></Field><label className="switch-row compact-switch"><input type="checkbox" checked={perms.allowAll} onChange={(e)=>setPerms({...perms,allowAll:e.target.checked})}/><span><b>Allow every operation</b><small>Use only for fully trusted administrators.</small></span></label></div>
         <div className="permission-accordion">{MODULE_GROUPS.map(([group,mods])=><details key={group} className="permission-group-details"><summary><div><b>{group}</b><span>{mods.length} modules</span></div><em>{mods.reduce((n,[m,actions])=>n+actions.filter((a)=>hasAction(perms,m,a)).length,0)} enabled</em></summary><div className="permission-group-body">{mods.map(([m,actions])=><section className="permission-module-v4" key={m}><div><b>{pretty(m)}</b><small>{actions.filter((a)=>hasAction(perms,m,a)).length}/{actions.length} enabled</small></div><div className="permission-action-pills">{actions.map((a)=><button type="button" aria-pressed={hasAction(perms,m,a)} key={a} className={hasAction(perms,m,a)?'enabled':''} onClick={()=>toggleAction(m,a)}><span>{hasAction(perms,m,a)?'✓':'+'}</span>{pretty(a)}</button>)}</div></section>)}</div></details>)}</div>
         <button className="primary access-save">Save operation permissions</button>
       </form></section>

       <section className="premium-section-card"><div className="premium-section-head"><div><small>VISIBILITY</small><h2>Who this employee can see</h2><p>Set visibility separately for Attendance, Salary, Employee Profile and Leave.</p></div></div><form onSubmit={saveScope}><Field label="Data resource"><select value={dataGrant.resource} onChange={(e)=>setDataGrant({...dataGrant,resource:e.target.value})}>{DATA_RESOURCES.map((r)=><option key={r}>{pretty(r)}</option>)}</select></Field><div className="scope-mode-grid v4"><button type="button" className={scopeMode==='BOTH'?'active':''} onClick={()=>applyScope('BOTH')}><span>◫</span><b>Office + Factory</b><small>All active employees</small></button><button type="button" className={scopeMode==='OFFICE'?'active':''} onClick={()=>applyScope('OFFICE')}><span>⌂</span><b>Office only</b><small>Hide Factory employees</small></button><button type="button" className={scopeMode==='FACTORY'?'active':''} onClick={()=>applyScope('FACTORY')}><span>F</span><b>Factory only</b><small>Hide Office employees</small></button><button type="button" className={scopeMode==='SELECTED'?'active':''} onClick={()=>applyScope('SELECTED')}><span>◎</span><b>Selected people</b><small>Individual employee list</small></button></div>{scopeMode==='SELECTED'&&<div className="employee-selector-compact">{scopedEmployees.map((emp)=><label key={emp._id} className={dataGrant.employeeIds.includes(emp._id)?'selected':''}><input type="checkbox" checked={dataGrant.employeeIds.includes(emp._id)} onChange={()=>toggleEmployee(emp._id)}/><span className="employee-mini-avatar">{`${emp.firstName?.[0]||''}${emp.lastName?.[0]||''}`}</span><span><b>{emp.firstName} {emp.lastName||''}</b><small>{emp.employeeCode} · {emp.workLocation||'FACTORY'}</small></span></label>)}</div>}<Field label="Reason / note"><input value={dataGrant.notes} onChange={(e)=>setDataGrant({...dataGrant,notes:e.target.value})} placeholder="Example: Factory HR attendance responsibility"/></Field><button className="primary access-save">Save visibility scope</button></form></section>

       <details className="premium-collapsible"><summary><div><small>SAVED CONFIGURATION</small><b>Existing visibility grants</b></div><span>{grantsData?.grants?.length||0} grants</span></summary><div className="collapsible-body">{!(grantsData?.grants||[]).length?<Empty/>:<div className="grant-cards v4">{grantsData.grants.map((g)=><article key={g._id}><div><b>{g.viewerUserId?.name||g.viewerUserId?.email}</b><span>{pretty(g.resource)}</span></div><em>{g.canViewAll?(g.workLocations?.length===2?'Office + Factory':`${g.workLocations?.[0]||'All'} only`):`${g.employeeIds?.length||0} selected people`}</em><button onClick={()=>del(g._id)}>Remove</button></article>)}</div>}</div></details>
     </main>
   </div>
 </div>;
}
