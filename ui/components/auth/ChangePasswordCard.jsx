import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../Ui.jsx';
import Icon from '../Icon.jsx';
import PasswordInput from './PasswordInput.jsx';
import PasswordRules, { passwordProblems } from './PasswordRules.jsx';
import { useAuth } from '../../state/AuthContext.jsx';
import '../../styles/login.css';

function when(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "My profile" → change password. Signs out every other device. */
export default function ChangePasswordCard() {
  const { user, changePassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    const problems = passwordProblems(password);
    if (problems.length) { setError(problems[0]); return; }
    if (password !== confirm) { setError('The two new passwords are not the same.'); return; }
    setSaving(true);
    try {
      await changePassword(current, password);
      toast.success('Password changed. Other devices were signed out.');
      setCurrent(''); setPassword(''); setConfirm(''); setOpen(false);
    } catch (err) {
      setError(err.message || 'Could not change the password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Sign-in & password">
      <div className="pw-card">
        <div className="pw-card-facts">
          <div><span>Login</span><strong>{user?.email || '—'}</strong></div>
          <div><span>Last sign-in</span><strong>{when(user?.lastLoginAt)}</strong></div>
          <div><span>Password changed</span><strong>{when(user?.passwordChangedAt)}</strong></div>
        </div>
        {!open ? (
          <button type="button" className="secondary" onClick={() => setOpen(true)}><Icon name="KeyRound" size={15} /> Change password</button>
        ) : (
          <form className="pw-card-form jpk-auth-form" onSubmit={submit} noValidate>
            {error && <div className="jpk-auth-alert" role="alert"><Icon name="CircleAlert" size={16} /><span>{error}</span></div>}
            <label className="jpk-field" htmlFor="cp-current"><span>Current password</span><PasswordInput id="cp-current" value={current} onChange={setCurrent} autoFocus /></label>
            <label className="jpk-field" htmlFor="cp-new"><span>New password</span><PasswordInput id="cp-new" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" /></label>
            <label className="jpk-field" htmlFor="cp-confirm"><span>Type the new password again</span><PasswordInput id="cp-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" /></label>
            <PasswordRules password={password} confirm={confirm} />
            <div className="pw-card-actions">
              <button type="submit" className="primary" disabled={saving || !current || !password}><Icon name={saving ? 'Loader2' : 'Save'} size={15} className={saving ? 'spin' : ''} /> {saving ? 'Saving…' : 'Save new password'}</button>
              <button type="button" className="secondary" onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
