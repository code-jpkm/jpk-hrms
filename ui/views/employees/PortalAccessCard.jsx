import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Icon from '../../components/Icon.jsx';
import { patch, post } from '../../api/client.js';
import { hasAbility } from '../../utils/permissions.js';
import { formatDate } from '../../utils/time.js';

const ROLE_LABEL = { EMPLOYEE: 'Employee', MANAGER: 'Manager', HR_ADMIN: 'HR Admin', SUPER_ADMIN: 'Super Admin' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPER_NOTE = 'A Super Admin can do everything in the HRMS: every employee and salary, company settings, and other admins\' logins.';

/** Where this person stands with the portal, in plain words. */
export function portalState(employee, me) {
  const u = employee?.userId && typeof employee.userId === 'object' ? employee.userId : null;
  if (u && me && String(u._id) === String(me._id)) return 'self';
  if (employee?.status === 'OFFBOARDED') return 'offboarded';
  if (!u) return employee?.email ? 'none' : 'noEmail';
  if (u.status && u.status !== 'ACTIVE') return 'off';
  if (!u.passwordChangedAt) return 'none';
  if (u.forcePasswordChange) return 'waiting';
  return 'active';
}

function ago(value) {
  if (!value) return '';
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : days < 30 ? `${days} days ago` : formatDate(value);
}

/**
 * One box on the profile for everything about signing in: give access, send a
 * new password, change the role, turn access off. Each is one button.
 */
export default function PortalAccessCard({ employee, me, onChanged, onLoginResult }) {
  const canManageLogin = hasAbility(me, 'EMPLOYEES', 'MANAGE_LOGIN');
  const canChangeRole = hasAbility(me, 'ACCESS', 'MANAGE');
  const canEdit = hasAbility(me, 'EMPLOYEES', 'UPDATE');
  const isSuperAdmin = String(me?.role || '').toUpperCase() === 'SUPER_ADMIN';
  const u = employee?.userId && typeof employee.userId === 'object' ? employee.userId : null;
  const state = portalState(employee, me);
  const loginId = [u?.email || employee?.email, employee?.employeeCode].filter(Boolean).join(' or ');

  const [busy, setBusy] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('EMPLOYEE');
  useEffect(() => { setEmail(''); setRole(u?.role || 'EMPLOYEE'); }, [employee?._id, u?.role]);

  // Admin roles are offered only to a Super Admin (the server checks this too).
  const roles = ['EMPLOYEE', 'MANAGER', ...(isSuperAdmin ? ['HR_ADMIN', 'SUPER_ADMIN'] : [])];
  if (u?.role && !roles.includes(u.role)) roles.push(u.role);
  const adminLogin = ['SUPER_ADMIN', 'HR_ADMIN'].includes(u?.role) && !isSuperAdmin;

  async function run(name, fn) {
    setBusy(name);
    try { await fn(); } catch (err) { toast.error(err?.message || 'That did not work. Try again.'); } finally { setBusy(''); }
  }

  // Making someone Super Admin is the one choice that asks first.
  const superOk = (next, giving) => next !== 'SUPER_ADMIN' || window.confirm(`${giving ? `Give ${employee.firstName || 'this person'} portal access as a Super Admin?` : `Make ${employee.firstName || 'this person'} a Super Admin?`}\n\n${SUPER_NOTE}`);

  const sendLogin = () => run('give', async () => {
    const res = await post(`/employees/${employee._id}/resend-login`, !u ? { role } : {}, { toast: false });
    onLoginResult?.(res);
    onChanged?.();
  });

  const giveAccess = () => {
    if (!u && !superOk(role, true)) return;
    sendLogin();
  };

  const saveEmailAndGive = (event) => {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL.test(value)) { toast.error('Type a full email address, for example name@jpkm.in'); return; }
    if (!superOk(role, true)) return;
    run('give', async () => {
      await patch(`/employees/${employee._id}`, { email: value }, { toast: false });
      const res = await post(`/employees/${employee._id}/resend-login`, { role }, { toast: false });
      onLoginResult?.(res);
      onChanged?.();
    });
  };

  const newPassword = () => {
    if (!window.confirm(`Send ${employee.firstName || 'them'} a new temporary password?\n\nTheir current password stops working, and they are signed out until they use the new one.`)) return;
    sendLogin();
  };

  const turnOff = () => {
    if (!window.confirm(`Turn off portal access for ${employee.firstName || 'this person'}?\n\nThey can no longer sign in. Their attendance, leave and payslips stay. You can turn it on again any time.`)) return;
    run('off', async () => {
      const res = await post(`/employees/${employee._id}/portal-access/off`, {}, { toast: false });
      toast.success(res?.message || 'Portal access turned off.');
      onChanged?.();
    });
  };

  const changeRole = (next) => {
    if (!superOk(next, false)) return;
    run('role', async () => {
      await patch(`/employees/users/${u._id}/permissions`, { role: next }, { toast: false });
      setRole(next);
      toast.success(`${employee.firstName || 'Their'} portal role is now ${ROLE_LABEL[next] || next}.`);
      onChanged?.();
    });
  };

  const roleSelect = (disabled, onChange) => (
    <label className="pa-role">
      <span>Role</span>
      <select value={role} onChange={(e) => onChange(e.target.value)} disabled={disabled || Boolean(busy)}>
        {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
      </select>
    </label>
  );

  const view = {
    self: { tone: 'ok', icon: 'CircleUser', title: 'This is you', text: 'Change your own password under My account.' },
    offboarded: { tone: 'muted', icon: 'Ban', title: 'No portal access', text: 'This person is offboarded, so they cannot sign in. Re-activate the profile first if they are back.' },
    noEmail: { tone: 'muted', icon: 'Mail', title: 'No portal access', text: 'Add their email to give them a login. They sign in with the email or their employee code.' },
    none: { tone: 'muted', icon: 'KeyRound', title: u ? 'Has a login, but no password yet' : 'No portal access yet', text: `One click makes their login and sends a temporary password by email and WhatsApp. They sign in with ${loginId}.` },
    off: { tone: 'muted', icon: 'Ban', title: 'Portal access is turned off', text: 'They cannot sign in. Turn it on to send them a new temporary password.' },
    waiting: { tone: 'warn', icon: 'Clock3', title: 'Waiting for their first sign-in', text: `Login details sent ${ago(u?.tempPasswordSentAt) || 'earlier'}. They sign in with ${loginId} and the temporary password, then choose their own.` },
    active: { tone: 'ok', icon: 'CircleCheck', title: 'Has portal access', text: `Signs in with ${loginId}.${u?.lastSeenAt || u?.lastLoginAt ? ` Last active ${ago(u.lastSeenAt || u.lastLoginAt)}.` : ' Has not signed in yet.'}` }
  }[state];

  return (
    <section className="card premium-card portal-access" aria-label="Portal access">
      <div className="pa-head">
        <span className={`pa-icon ${view.tone}`}><Icon name={view.icon} size={18} /></span>
        <div className="pa-text">
          <small>Portal access</small>
          <b>{view.title}</b>
          <p>{view.text}</p>
        </div>
        {u && !['self', 'offboarded'].includes(state) && <span className="pa-role-tag">{ROLE_LABEL[u.role] || u.role}</span>}
      </div>

      {canManageLogin && !['self', 'offboarded'].includes(state) && !adminLogin && (
        <div className="pa-actions">
          {state === 'noEmail' && (canEdit ? (
            <form className="pa-email" onSubmit={saveEmailAndGive} noValidate>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their.name@jpkm.in" aria-label="Email for the login" disabled={Boolean(busy)} />
              {roleSelect(false, setRole)}
              <button type="submit" className="primary" disabled={Boolean(busy) || !email.trim()}><Icon name={busy ? 'Loader2' : 'KeyRound'} size={15} /> {busy ? 'Giving access…' : 'Save email and give access'}</button>
            </form>
          ) : <p className="pa-note">Ask someone who can edit employees to add their email.</p>)}

          {state === 'none' && (
            <>
              {!u && roleSelect(false, setRole)}
              <button type="button" className="primary" onClick={giveAccess} disabled={Boolean(busy)}><Icon name={busy === 'give' ? 'Loader2' : 'KeyRound'} size={15} /> {busy === 'give' ? 'Giving access…' : 'Give portal access'}</button>
            </>
          )}

          {state === 'off' && (
            <button type="button" className="primary" onClick={giveAccess} disabled={Boolean(busy)}><Icon name={busy === 'give' ? 'Loader2' : 'KeyRound'} size={15} /> {busy === 'give' ? 'Turning on…' : 'Turn on and send a password'}</button>
          )}

          {(state === 'waiting' || state === 'active') && (
            <>
              <button type="button" onClick={newPassword} disabled={Boolean(busy)}><Icon name={busy === 'give' ? 'Loader2' : 'RefreshCw'} size={15} /> {state === 'waiting' ? 'Send a new password' : 'Reset password'}</button>
              <button type="button" className="danger-lite" onClick={turnOff} disabled={Boolean(busy)}><Icon name={busy === 'off' ? 'Loader2' : 'Ban'} size={15} /> Turn off access</button>
            </>
          )}

          {u && canChangeRole && state !== 'off' && roleSelect(false, changeRole)}
        </div>
      )}
      {adminLogin && canManageLogin && state !== 'offboarded' && <p className="pa-note">This is an admin login. Only a Super Admin can change it.</p>}
    </section>
  );
}
