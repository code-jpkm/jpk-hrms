import React, { useState } from 'react';
import { Card, Empty, ErrorBox, Field, Table } from '../components/Ui.jsx';
import { post } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../state/AuthContext.jsx';
import { canApplyOnBehalf, hasAbility } from '../utils/permissions.js';

export default function Permissions() {
  const { user } = useAuth();
  const allowOnBehalf = canApplyOnBehalf(user);
  const canApprovePermission = hasAbility(user, 'PERMISSIONS', 'APPROVE') || ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);
  const { data, error, reload } = useApi('/permissions', []);
  const { data: employees } = useApi('/employees', []);
  const [form, setForm] = useState({ employeeId: '', type: 'LATE_IN', date: '', requestedMinutes: 15, reason: '' });
  const [decisionRemarks, setDecisionRemarks] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const [message, setMessage] = useState('');
  function set(key, value) { setForm((f) => ({ ...f, [key]: value })); }
  async function apply(e) {
    e.preventDefault(); setSubmitError(null); setMessage('');
    try { await post('/permissions', form); setMessage('Permission submitted to HR/Admin for approval.'); reload(); } catch (err) { setSubmitError(err); }
  }
  async function decide(id, status, hrOverride = false) {
    setSubmitError(null); setMessage('');
    try { await post(`/permissions/${id}/decision`, { status, remarks: decisionRemarks || status, hrOverride }); setMessage(`Permission ${status.toLowerCase()}.`); reload(); } catch (err) { setSubmitError(err); }
  }
  return <div className="page">
    <h1>Late In / Early Leave Permissions</h1>
    <ErrorBox error={error || submitError} />
    <Card title="Apply permission">
      <form className="form-grid" onSubmit={apply}>
        {allowOnBehalf && <Field label="Apply on behalf"><select value={form.employeeId || ''} onChange={(e) => set('employeeId', e.target.value)}><option value="">Myself</option>{(employees?.employees || []).map((emp) => <option key={emp._id} value={emp._id}>{emp.employeeCode} · {emp.firstName} {emp.lastName}</option>)}</select></Field>}
        <Field label="Permission type"><select value={form.type} onChange={(e) => set('type', e.target.value)}><option>LATE_IN</option><option>EARLY_LEAVE</option><option>MEDICAL</option><option>SPECIAL</option></select></Field>
        <Field label="Date"><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} required /></Field>
        <Field label="Minutes"><input type="number" value={form.requestedMinutes} onChange={(e) => set('requestedMinutes', Number(e.target.value))} /></Field>
        <Field label="Reason"><input value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Reason / medical / special note" /></Field>
        <button className="primary">Submit</button>
      </form>
    </Card>
    <Card title="Requests and approvals — late-in / early-leave / medical / special are HR/Admin approval only">
      <Field label="Decision remarks"><input value={decisionRemarks} onChange={(e) => setDecisionRemarks(e.target.value)} placeholder="Optional approval/rejection note" /></Field>
      {!data?.requests?.length ? <Empty /> : <Table columns={['Employee', 'Type', 'Date', 'Minutes', 'Reason', 'Applied By', 'Approver', 'Status', 'Actions']} rows={data.requests} renderRow={(r) => <tr key={r._id}>
        <td>{r.employeeId?.employeeCode} {r.employeeId?.firstName}</td><td>{r.type}</td><td>{new Date(r.date).toLocaleDateString()}</td><td>{r.requestedMinutes}</td><td>{r.reason}</td><td>{r.appliedOnBehalf ? 'HR/Admin on behalf' : 'Self'}</td><td>{r.approverEmployeeId?.employeeCode || 'HR/Admin'}</td><td>{r.status}{r.hrOverride ? ' / HR override' : ''}</td><td>{canApprovePermission && r.status === 'PENDING' && <><button onClick={() => decide(r._id, 'APPROVED')}>Approve</button><button onClick={() => decide(r._id, 'REJECTED')}>Reject</button><button onClick={() => decide(r._id, 'APPROVED', true)}>HR special override</button></>}</td>
      </tr>} />}
    </Card>
  </div>;
}
