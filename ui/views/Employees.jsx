import IssueLetter from './employees/IssueLetter.jsx';
import React, { useEffect, useMemo, useState } from 'react';
import { formatDate } from '../utils/time.js';
import { useSearchParams } from '../lib/router.jsx';
import LoginDetailsPanel from '../components/auth/LoginDetailsPanel.jsx';
import '../styles/login.css';
import toast from 'react-hot-toast';
import { Card, Empty, ErrorBox, Field } from '../components/Ui.jsx';
import { DirectorySkeleton, InlineSkeleton } from '../components/Loading.jsx';
import { api, post, patch, remove } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { hasAbility } from '../utils/permissions.js';

function initialForm() {
  return {
    employeeCode: '', firstName: '', lastName: '', email: '', phone: '', role: 'EMPLOYEE', reportsTo: '', department: '', designation: '', workLocation: 'FACTORY', employeeCategory: 'SALARIED', employmentType: 'FRESHER', previousExperienceYears: 0, previousCompany: '', dateOfJoining: '', dateOfBirth: '',
    biometric: { code: '', deviceUserId: '' }, canUseGeofencing: false, canUseAnywhereAttendance: false, canApplyWfh: false, createLogin: true, sendWelcome: true,
    personalDetails: { gender: '', bloodGroup: '', currentAddress: '', permanentAddress: '' },
    emergencyContact: { name: '', relation: '', phone: '' },
    bankDetails: { bankName: '', accountNumber: '', ifsc: '', salaryBankName: '', salaryAccountNumber: '', salaryIfsc: '' },
    statutory: { aadharNumber: '', pan: '', pfNumber: '', uan: '', esiNumber: '', ptaxNumber: '', pfApplicable: true, esiApplicable: true, ptaxApplicable: true },
    salary: { basic: 0, hra: 0, allowances: 0, gross: 0 },
    probation: { enabled: true, months: 6 }
  };
}

function fullName(e) { return `${e?.firstName || ''} ${e?.lastName || ''}`.trim() || 'Employee'; }
function initials(e) { return fullName(e).split(' ').filter(Boolean).slice(0,2).map((p)=>p[0]).join('').toUpperCase() || 'E'; }
function v(x, fallback='-') { return x === 0 ? '0' : (x || fallback); }
function employeePhoto(e) { return e?.profilePhotoUrl || ''; }
// v27: password sign-in. Older (Google) logins have no password until HR sends login details.
function loginStatus(e) {
  const u = e?.userId;
  if (!u || typeof u !== 'object') return { label: 'No login', tone: 'muted' };
  if (u.status && u.status !== 'ACTIVE') return { label: 'Login disabled', tone: 'muted' };
  if (!u.passwordChangedAt) return { label: 'No password yet', tone: 'warn' };
  if (u.forcePasswordChange) return { label: 'Waiting for first sign-in', tone: 'warn' };
  return { label: 'Password set', tone: 'ok' };
}
function isOnline(e) { const seen = e?.userId?.lastSeenAt; return Boolean(seen && (Date.now() - new Date(seen).getTime()) < 3 * 60 * 1000); }
function lastActive(e) {
  if (isOnline(e)) return 'Online now';
  const value = e?.userId?.lastSeenAt || e?.userId?.lastLoginAt;
  if (!value) return e?.userId ? 'Not active recently' : 'Portal access not enabled';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `Last active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Last active yesterday';
  if (days < 7) return `Last active ${days}d ago`;
  return `Last active ${new Date(value).toLocaleDateString([], { day:'2-digit', month:'short' })}`;
}
function EmployeeAvatar({ employee, large = false }) {
  const photo = employeePhoto(employee);
  return <span className={`people-avatar ${large ? 'large' : ''}`}>{photo ? <img src={photo} alt="" loading="lazy" decoding="async" /> : <b>{initials(employee)}</b>}<i className={isOnline(employee) ? 'presence online' : 'presence'} /></span>;
}

function InfoRow({ label, value }) { return <div className="info-row"><span>{label}</span><strong>{v(value)}</strong></div>; }
function Pill({ children, tone='' }) { return <span className={`mini-pill ${tone}`}>{children}</span>; }

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function EmployeeDocuments({ employeeId, employeeName, canUpload, canDelete, onChanged }) {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(true);
  async function load() {
    if (!employeeId) { setLoadingDocs(false); return; }
    setLoadingDocs(true);
    try { const res = await api(`/documents?ownerType=EMPLOYEE&ownerId=${employeeId}`); setDocuments(res.documents || []); } catch (err) { setError(err); } finally { setLoadingDocs(false); }
  }
  useEffect(() => { load(); }, [employeeId]);
  async function upload(e, type) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await post('/documents', { ownerType: 'EMPLOYEE', ownerId: employeeId, type, label: type.replaceAll('_', ' '), fileName: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl });
      await load();
      if (type === 'PHOTO') onChanged?.();
    } catch (err) { setError(err); } finally { setBusy(false); e.target.value = ''; }
  }
  async function download(doc) {
    try { const blob = await api(`/documents/${doc._id}/download`); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = doc.fileName; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); toast.success('Document download started'); } catch (err) { setError(err); toast.error(err.message || 'Could not download document'); }
  }
  async function deleteDoc(doc) {
    if (!window.confirm('Delete this document?')) return;
    try { await remove(`/documents/${doc._id}`); await load(); } catch (err) { setError(err); }
  }
  const types = ['PHOTO','AADHAR_CARD','PAN_CARD','ACADEMIC_CERTIFICATE','RESUME','PREVIOUS_PAYSLIP','BANK_STATEMENT','EXPERIENCE_LETTER','OTHER'];
  return <Card title="Documents" actions={<span className="muted small">Aadhaar, PAN, academics, bank statement, payslip, resume</span>}>
    <ErrorBox error={error} />
    {canUpload && <IssueLetter employeeId={employeeId} employeeName={employeeName} onIssued={load} />}
    {canUpload && <div className="document-upload-grid">{types.map((t)=><label className="doc-upload" key={t}>{t.replaceAll('_',' ')}<input type="file" accept={t==='PHOTO'?'image/*':undefined} onChange={(e)=>upload(e,t)} disabled={busy} /></label>)}</div>}
    <div className="doc-list">{loadingDocs ? <InlineSkeleton label="Loading employee documents" /> : !documents.length ? <Empty /> : documents.map((d)=><div className="doc-chip" key={d._id}><span><b>{d.label}</b><small>{d.fileName} · {d.status}</small></span><button onClick={()=>download(d)}>Open</button>{canDelete && <button onClick={()=>deleteDoc(d)}>Delete</button>}</div>)}</div>
  </Card>;
}


export default function Employees() {
  const { user } = useAuth();
  const isSuperAdmin = String(user?.role || '').toUpperCase() === 'SUPER_ADMIN';
  const canCreate = hasAbility(user, 'EMPLOYEES', 'CREATE');
  const canUpdate = hasAbility(user, 'EMPLOYEES', 'UPDATE');
  const canDelete = hasAbility(user, 'EMPLOYEES', 'DELETE');
  const canManageLogin = hasAbility(user, 'EMPLOYEES', 'MANAGE_LOGIN');
  const canReadDocuments = hasAbility(user, 'DOCUMENTS', 'READ');
  const canUploadDocuments = hasAbility(user, 'DOCUMENTS', 'CREATE');
  const canDeleteDocuments = hasAbility(user, 'DOCUMENTS', 'DELETE');
  const { data, error, loading, reload } = useApi('/employees', []);
  const [searchParams, setSearchParams] = useSearchParams();
  const employees = data?.employees || [];
  const [mode, setMode] = useState('directory');
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [workplace, setWorkplace] = useState('ALL');
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(initialForm());
  const [editingId, setEditingId] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [message, setMessage] = useState('');
  const [loginResult, setLoginResult] = useState(null);
  const { data: loginSummary, reload: reloadLoginSummary } = useApi(canManageLogin ? '/employees/login-details/summary' : '', [canManageLogin]);

  // /employees?id=… (from the top search) opens that person's profile.
  useEffect(() => {
    const wanted = searchParams.get('id');
    if (!wanted || !data?.employees?.some((e) => e._id === wanted)) return;
    setSelectedId(wanted); setMode('profile');
    setSearchParams({}, { replace: true });
  }, [searchParams, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = useMemo(() => Array.from(new Set(employees.map((e) => e.department).filter(Boolean))).sort(), [employees]);
  const filtered = useMemo(() => employees.filter((e) => {
    const hay = `${e.employeeCode} ${fullName(e)} ${e.department || ''} ${e.designation || ''} ${e.email || ''}`.toLowerCase();
    return hay.includes(query.toLowerCase()) && (!department || e.department === department) && (workplace === 'ALL' || e.workLocation === workplace || e.workLocation === 'BOTH');
  }), [employees, query, department, workplace]);
  const selected = employees.find((e) => e._id === selectedId) || filtered[0] || employees[0];
  const employeeOptions = employees.filter((e) => e._id !== editingId);
  const activeCount = employees.filter((e) => e.status !== 'OFFBOARDED').length;
  const onlineCount = employees.filter(isOnline).length;
  const officeCount = employees.filter((e) => e.workLocation === 'OFFICE' || e.workLocation === 'BOTH').length;
  const factoryCount = employees.filter((e) => e.workLocation === 'FACTORY' || e.workLocation === 'BOTH').length;

  function set(path, value) { setForm((f) => ({ ...f, [path]: value })); }
  function setNested(group, key, value) { setForm((f) => ({ ...f, [group]: { ...(f[group] || {}), [key]: value } })); }

  function openAdd() { setEditingId(null); setForm(initialForm()); setMode('add'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function startEdit(emp) {
    setEditingId(emp._id); setMode('add');
    setForm({ ...initialForm(), ...emp, reportsTo: emp.reportsTo?._id || emp.reportsTo || '', role: emp.userId?.role || emp.role || 'EMPLOYEE', biometric: { ...initialForm().biometric, ...(emp.biometric || {}) }, personalDetails: { ...initialForm().personalDetails, ...(emp.personalDetails || {}) }, emergencyContact: { ...initialForm().emergencyContact, ...(emp.emergencyContact || {}) }, bankDetails: { ...initialForm().bankDetails, ...(emp.bankDetails || {}) }, statutory: { ...initialForm().statutory, ...(emp.statutory || {}) }, salary: { ...initialForm().salary, ...(emp.salary || {}) }, probation: { ...initialForm().probation, ...(emp.probation || {}) }, createLogin: false, sendWelcome: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function view(emp) { setSelectedId(emp._id); setMode('profile'); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  async function saveEmployee(e) {
    e.preventDefault(); setSubmitError(null); setMessage('');
    try {
      const payload = { ...form, email: form.email?.trim() || undefined, reportsTo: form.reportsTo || '' };
      const saved = editingId ? await patch(`/employees/${editingId}`, payload) : await post('/employees', payload);
      setMessage(editingId ? 'Employee updated successfully.' : 'Employee created and hierarchy updated.');
      if (!editingId && saved?.temporaryPassword) {
        setLoginResult({ message: saved.loginMessage, temporaryPassword: saved.temporaryPassword, loginEmail: saved.user?.email, loginDelivered: saved.loginDelivered, notificationLogs: saved.notificationLogs });
        reloadLoginSummary();
      }
      setForm(initialForm()); setEditingId(null); setMode('directory'); reload();
    } catch (err) { setSubmitError(err); }
  }
  async function offboard(id) { if (!window.confirm('Offboard this employee and disable login?')) return; try { await post(`/employees/${id}/offboard`, {}); setMessage('Employee offboarded.'); reload(); } catch (err) { setSubmitError(err); } }
  async function deleteEmployee(id) { if (!window.confirm('Hard delete this employee?')) return; try { await remove(`/employees/${id}`); setMessage('Employee deleted.'); reload(); } catch (err) { setSubmitError(err); } }
  async function resendLogin(id) {
    const person = employees.find((x) => x._id === id);
    if (!window.confirm(`Send new login details to ${person ? fullName(person) : 'this employee'}?\n\nThis makes a new temporary password, sends it by email / WhatsApp and signs them out of the HRMS until they use it.`)) return;
    try {
      const res = await post(`/employees/${id}/resend-login`, {}, { toast: false });
      setLoginResult(res); reload(); reloadLoginSummary();
    } catch (err) { setSubmitError(err); }
  }
  async function sendLoginDetailsToAll() {
    const count = loginSummary?.withoutPassword || 0;
    if (!window.confirm(`Send login details to ${count} ${count === 1 ? 'person' : 'people'} who have no password yet?\n\nEach gets a temporary password by email / WhatsApp. For anyone the message cannot reach, you will get the password to hand over.`)) return;
    try {
      const res = await post('/employees/login-details/send-all', {}, { loadingMessage: 'Sending login details…', toast: false });
      setLoginResult(res); reload(); reloadLoginSummary();
    } catch (err) { setSubmitError(err); }
  }
  async function downloadLetter(emp, type) { try { const blob = await api(`/employees/${emp._id}/letters/${type}/download`); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${type}-letter-${emp.employeeCode}.pdf`; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); toast.success('Employee letter download started'); } catch (err) { setSubmitError(err); toast.error(err.message || 'Could not download employee letter'); } }
  async function downloadEmployeeTemplate() { setSubmitError(null); try { const blob=await api('/employees/import-template.xlsx'); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='JPK-Employee-Import-Template.xlsx'; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); toast.success('Employee Excel template download started'); } catch(err){setSubmitError(err); toast.error(err.message || 'Could not download employee template');} }
  async function importEmployees(e) { const file=e.target.files?.[0]; if(!file) return; setSubmitError(null); setMessage(''); try { const dataUrl=await fileToDataUrl(file); const res=await post('/employees/import-excel',{fileName:file.name,dataUrl}); setMessage(`Excel import complete: ${res.created} created, ${res.updated} updated${res.errors?.length ? `, ${res.errors.length} row error(s)` : ''}. Existing employees were updated by Employee Code; nobody was deleted.`); reload(); } catch(err){setSubmitError(err);} finally{e.target.value='';} }

  return <div className="nexus-page employee-module">
    <ErrorBox error={error || submitError} />
    {loginResult && <LoginDetailsPanel result={loginResult} onClose={() => setLoginResult(null)} />}
    

    <section className="directory-hero people-hero-v22 page-intro">
      <div className="people-hero-copy"><small>PEOPLE · DIRECTORY · PRESENCE</small><h1>Your whole team, beautifully organized.</h1><p>Everyone in the company. Search for a person, open their profile, or add a new employee.</p><div className="people-stats"><span><b>{activeCount}</b><small>Active</small></span><span><b>{onlineCount}</b><small>Online now</small></span><span><b>{officeCount}</b><small>Office</small></span><span><b>{factoryCount}</b><small>Factory</small></span></div></div>
      <div className="hero-actions people-actions">{canManageLogin && loginSummary?.withoutPassword > 0 && <button type="button" className="primary" onClick={sendLoginDetailsToAll} title="Google sign-in was replaced by passwords. Give everyone their login details in one go.">🔑 Send login details to {loginSummary.withoutPassword} without a password</button>}<button onClick={() => { setMode('directory'); setSelectedId(''); }}>Directory</button>{selected && <button onClick={() => view(selected)}>Open profile</button>}{canCreate && <><button onClick={downloadEmployeeTemplate}>Excel template</button><label className="file-button">Import Excel<input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={importEmployees}/></label><button className="primary" onClick={openAdd}>+ Add employee</button></>}<button onClick={reload}>↻ Refresh</button></div>
    </section>

    {mode === 'directory' && <>
      <section className="directory-filter premium-filter people-filter-v22"><label className="people-search"><span>⌕</span><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search people, code, department, designation…" /></label><div className="segmented"><button className={workplace==='ALL'?'active':''} onClick={()=>setWorkplace('ALL')}>Everyone</button><button className={workplace==='OFFICE'?'active':''} onClick={()=>setWorkplace('OFFICE')}>Office</button><button className={workplace==='FACTORY'?'active':''} onClick={()=>setWorkplace('FACTORY')}>Factory</button></div><select value={department} onChange={(e)=>setDepartment(e.target.value)}><option value="">All departments</option>{departments.map((d)=><option key={d}>{d}</option>)}</select><strong>{filtered.length} people</strong></section>
      {loading ? <DirectorySkeleton count={8} /> : !filtered.length ? <Empty /> : <div className="people-directory-grid">{filtered.map((emp)=><button className="people-card" key={emp._id} onClick={()=>view(emp)}><div className="people-card-top"><EmployeeAvatar employee={emp}/><span className={`location-chip ${String(emp.workLocation||'').toLowerCase()}`}>{emp.workLocation === 'BOTH' ? 'Office + Factory' : (emp.workLocation || 'Factory')}</span></div><div className="people-card-name"><b>{fullName(emp)}</b><span>{emp.designation || 'Employee'}</span></div><div className="people-card-meta"><span>{emp.department || 'General'}</span><span>{emp.employeeCode}</span></div><div className={`people-presence ${isOnline(emp)?'online':''}`}><i /> <span>{lastActive(emp)}</span></div><div className="people-card-footer"><small>{emp.userId?.role ? emp.userId.role.replaceAll('_',' ') : 'EMPLOYEE'}</small><span>View profile →</span></div></button>)}</div>}
    </>}

    {mode === 'profile' && selected && <section className="profile-view profile-v22">
      {isSuperAdmin && selected.needsProfileReview && <div className="profile-review-alert"><b>Profile update required</b><span>Missing: {(selected.profileReviewMissing || []).join(', ')}. Complete these fields so attendance, leave and payroll rules can work correctly.</span></div>}<div className="profile-banner profile-banner-v22"><EmployeeAvatar employee={selected} large/><div className="profile-title-v22"><span className={`presence-text ${isOnline(selected)?'online':''}`}><i/>{lastActive(selected)}</span><h1>{fullName(selected)}</h1><p>{selected.designation || 'Employee'} · {selected.department || 'General'}</p><div className="profile-tags"><Pill>{selected.employeeCode}</Pill><Pill>{selected.workLocation || 'FACTORY'}</Pill><Pill>{selected.employeeCategory || 'SALARIED'}</Pill><Pill tone="green">{selected.status || 'Active'}</Pill></div></div><div className="profile-buttons">{canUpdate && <button className="yellow-btn" onClick={()=>startEdit(selected)}>Edit profile</button>}<button onClick={()=>setMode('directory')}>← Directory</button>{canDelete && <button className="danger-soft" onClick={()=>deleteEmployee(selected._id)}>Delete</button>}</div></div>
      <div className="quick-facts"><InfoRow label="Email" value={selected.email || selected.userId?.email} /><div className="info-row"><span>Login</span><strong><span className={`login-status ${loginStatus(selected).tone}`}>{loginStatus(selected).label}</span></strong></div><InfoRow label="Contact" value={selected.phone} /><InfoRow label="Reports To" value={selected.reportsTo ? `${selected.reportsTo.employeeCode} · ${selected.reportsTo.firstName || ''}` : 'Top level'} /><InfoRow label="Joined" value={selected.dateOfJoining ? formatDate(selected.dateOfJoining) : '-'} /></div>
      <Card title="Job & Reporting"><InfoRow label="Designation" value={selected.designation} /><InfoRow label="Department" value={selected.department} /><InfoRow label="Workplace" value={selected.workLocation} /><InfoRow label="Employment Type" value={selected.employmentType} /><InfoRow label="Category" value={selected.employeeCategory} /><InfoRow label="Boarding" value={selected.status} /></Card>
      <Card title="Personal"><InfoRow label="Gender" value={selected.personalDetails?.gender} /><InfoRow label="Date of Birth" value={selected.dateOfBirth ? formatDate(selected.dateOfBirth) : '-'} /><InfoRow label="Emergency Contact" value={`${v(selected.emergencyContact?.name)} ${selected.emergencyContact?.phone || ''}`} /><InfoRow label="Address" value={selected.personalDetails?.currentAddress} /></Card>
      <Card title="Statutory & Bank"><InfoRow label="Aadhaar No." value={selected.statutory?.aadharNumber} /><InfoRow label="PAN No." value={selected.statutory?.pan} /><InfoRow label="UAN" value={selected.statutory?.uan} /><InfoRow label="ESIC" value={selected.statutory?.esiNumber} /><InfoRow label="Bank" value={selected.bankDetails?.bankName} /></Card>
      {selected.salary && <Card title="Salary"><InfoRow label="Gross Salary" value={selected.salary?.gross} /><InfoRow label="Basic" value={selected.salary?.basic} /><InfoRow label="HRA" value={selected.salary?.hra} /><InfoRow label="Allowances" value={selected.salary?.allowances} /></Card>}
      <Card title="Payroll & Letters" actions={<><button className="yellow-btn">₹ Revise Salary</button><button onClick={()=>downloadLetter(selected,'offer')}>Offer letter</button><button onClick={()=>downloadLetter(selected,'joining')}>Joining letter</button>{canManageLogin && <button onClick={()=>resendLogin(selected._id)}>🔑 Send login details</button>}{canDelete && <button onClick={()=>offboard(selected._id)}>Offboard</button>}</>}></Card>
      {canReadDocuments && <EmployeeDocuments employeeId={selected._id} employeeName={`${selected.firstName || ''} ${selected.lastName || ''}`.trim()} canUpload={canUploadDocuments} canDelete={canDeleteDocuments} onChanged={reload} />}
    </section>}

    {mode === 'add' && <Card title={editingId ? 'Edit Employee Profile' : 'Add Employee / Onboarding'}>
      <form className="nexus-form" onSubmit={saveEmployee}>
        <h3>Identity</h3>
        <Field label="Employee Code"><input value={form.employeeCode} onChange={(e)=>set('employeeCode', e.target.value)} required /></Field>
        <Field label="First Name"><input value={form.firstName} onChange={(e)=>set('firstName', e.target.value)} required /></Field>
        <Field label="Last Name"><input value={form.lastName} onChange={(e)=>set('lastName', e.target.value)} /></Field>
        <Field label="Mail ID / Login Email"><input type="email" value={form.email} onChange={(e)=>set('email', e.target.value)} required={form.createLogin !== false} /></Field>
        <Field label="WhatsApp / Phone"><input value={form.phone} onChange={(e)=>set('phone', e.target.value)} placeholder="919999999999" /></Field>
        <Field label="Login Role"><select value={form.role} onChange={(e)=>set('role', e.target.value)}><option>EMPLOYEE</option><option>MANAGER</option><option>HR_ADMIN</option><option>SUPER_ADMIN</option></select></Field>
        <h3>Job & Reporting</h3>
        <Field label="Reporting To / Manager"><select value={form.reportsTo || ''} onChange={(e)=>set('reportsTo', e.target.value)}><option value="">No reporting manager / top level</option>{employeeOptions.map((emp)=><option key={emp._id} value={emp._id}>{emp.employeeCode} · {fullName(emp)} · {emp.designation || 'Employee'}</option>)}</select></Field>
        <Field label="Department"><input value={form.department} onChange={(e)=>set('department', e.target.value)} /></Field>
        <Field label="Designation"><input value={form.designation} onChange={(e)=>set('designation', e.target.value)} /></Field>
        <Field label="Workplace"><select value={form.workLocation} onChange={(e)=>set('workLocation',e.target.value)}><option value="OFFICE">Office</option><option value="FACTORY">Factory</option><option value="BOTH">Office + Factory</option></select></Field>
        <Field label="Category"><select value={form.employeeCategory} onChange={(e)=>set('employeeCategory', e.target.value)}><option>SALARIED</option><option>WAGES</option></select></Field>
        <Field label="Fresher / Experienced"><select value={form.employmentType} onChange={(e)=>set('employmentType', e.target.value)}><option>FRESHER</option><option>EXPERIENCED</option></select></Field>
        <Field label="Experience Years"><input type="number" value={form.previousExperienceYears} onChange={(e)=>set('previousExperienceYears', Number(e.target.value))} /></Field>
        <Field label="Previous Company"><input value={form.previousCompany} onChange={(e)=>set('previousCompany', e.target.value)} /></Field>
        <Field label="Joining Date"><input type="date" value={form.dateOfJoining} onChange={(e)=>set('dateOfJoining', e.target.value)} /></Field>
        <Field label="Birth Date"><input type="date" value={form.dateOfBirth} onChange={(e)=>set('dateOfBirth', e.target.value)} /></Field>
        <h3>Attendance / Statutory</h3>
        <Field label="Biometric Code"><input value={form.biometric.code} onChange={(e)=>setNested('biometric','code',e.target.value)} /></Field>
        <Field label="Machine ID (on the attendance machine)"><input value={form.biometric.deviceUserId} onChange={(e)=>setNested('biometric','deviceUserId',e.target.value)} /></Field>
        <Field label="Aadhaar"><input value={form.statutory.aadharNumber} onChange={(e)=>setNested('statutory','aadharNumber',e.target.value)} /></Field>
        <Field label="PAN"><input value={form.statutory.pan} onChange={(e)=>setNested('statutory','pan',e.target.value)} /></Field>
        <Field label="PF / UAN"><input value={form.statutory.uan} onChange={(e)=>setNested('statutory','uan',e.target.value)} /></Field>
        <Field label="ESIC Number"><input value={form.statutory.esiNumber} onChange={(e)=>setNested('statutory','esiNumber',e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={form.statutory.pfApplicable !== false} onChange={(e)=>setNested('statutory','pfApplicable',e.target.checked)} /> PF applicable</label>
        <label className="check"><input type="checkbox" checked={form.statutory.esiApplicable !== false} onChange={(e)=>setNested('statutory','esiApplicable',e.target.checked)} /> ESI applicable</label>
        <label className="check"><input type="checkbox" checked={form.statutory.ptaxApplicable !== false} onChange={(e)=>setNested('statutory','ptaxApplicable',e.target.checked)} /> Professional Tax applicable</label>
        <h3>Bank / Emergency</h3>
        <Field label="Bank Name"><input value={form.bankDetails.bankName} onChange={(e)=>setNested('bankDetails','bankName',e.target.value)} /></Field>
        <Field label="Bank Account"><input value={form.bankDetails.accountNumber} onChange={(e)=>setNested('bankDetails','accountNumber',e.target.value)} /></Field>
        <Field label="IFSC"><input value={form.bankDetails.ifsc} onChange={(e)=>setNested('bankDetails','ifsc',e.target.value)} /></Field>
        <Field label="Emergency Contact"><input value={form.emergencyContact.name} onChange={(e)=>setNested('emergencyContact','name',e.target.value)} /></Field>
        <Field label="Emergency Phone"><input value={form.emergencyContact.phone} onChange={(e)=>setNested('emergencyContact','phone',e.target.value)} /></Field>
        <Field label="Gross Salary"><input type="number" value={form.salary.gross} onChange={(e)=>setNested('salary','gross',Number(e.target.value))} /></Field>
        <label className="check"><input type="checkbox" checked={form.probation.enabled} onChange={(e)=>setNested('probation','enabled',e.target.checked)} /> 6 months probation enabled</label>
        <label className="check"><input type="checkbox" checked={form.canUseGeofencing} onChange={(e)=>set('canUseGeofencing',e.target.checked)} /> Geofencing enabled</label>
        <label className="check"><input type="checkbox" checked={form.canUseAnywhereAttendance} onChange={(e)=>set('canUseAnywhereAttendance',e.target.checked)} /> Anywhere attendance</label>
        <label className="check"><input type="checkbox" checked={form.canApplyWfh === true} onChange={(e)=>set('canApplyWfh',e.target.checked)} /> Employee can apply Work From Home</label>
        <label className="check"><input type="checkbox" checked={form.createLogin} onChange={(e)=>set('createLogin',e.target.checked)} /> Create login</label>
        <label className="check"><input type="checkbox" checked={form.sendWelcome} onChange={(e)=>set('sendWelcome',e.target.checked)} /> Send login details (temporary password by email + WhatsApp)</label>
        <Field label="Current Address"><textarea value={form.personalDetails.currentAddress} onChange={(e)=>setNested('personalDetails','currentAddress',e.target.value)} /></Field>
        <Field label="Permanent Address"><textarea value={form.personalDetails.permanentAddress} onChange={(e)=>setNested('personalDetails','permanentAddress',e.target.value)} /></Field>
        <div className="inline-note">Documents are uploaded from the employee profile after saving, so HR can attach Aadhaar, PAN, academic certificate, previous payslip, bank statement, resume and experience letter against the saved employee record.</div>
        <div className="form-actions"><button className="yellow-btn">{editingId ? 'Update Employee' : 'Add Employee'}</button><button type="button" onClick={()=>{ setMode('directory'); setEditingId(null); setForm(initialForm()); }}>Cancel</button></div>
      </form>
    </Card>}
  </div>;
}
