import React, { useState } from 'react';
import { useAuth } from '../state/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import AuthLayout from '../components/auth/AuthLayout.jsx';
import PasswordInput from '../components/auth/PasswordInput.jsx';
import PasswordRules, { passwordProblems } from '../components/auth/PasswordRules.jsx';

/** Shown right after signing in with a temporary password from HR. */
export default function SetPassword() {
  const { user, changePassword, reload, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    const problems = passwordProblems(password);
    if (problems.length) { setError(problems[0]); return; }
    if (password !== confirm) { setError('The two new passwords are not the same.'); return; }
    setSubmitting(true);
    try {
      await changePassword(current, password);
      await reload();
    } catch (err) {
      setError(err.message || 'Could not save the password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Choose your own password" subtitle={`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}! You signed in with a temporary password. Pick a new one to continue.`} footer={null}>
      <form className="jpk-auth-form" onSubmit={submit} noValidate>
        {error && <div className="jpk-auth-alert" role="alert"><Icon name="CircleAlert" size={16} /><span>{error}</span></div>}
        <label className="jpk-field" htmlFor="sp-current">
          <span>Temporary password (from HR’s message)</span>
          <PasswordInput id="sp-current" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
        </label>
        <label className="jpk-field" htmlFor="sp-new">
          <span>New password</span>
          <PasswordInput id="sp-new" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" />
        </label>
        <label className="jpk-field" htmlFor="sp-confirm">
          <span>Type the new password again</span>
          <PasswordInput id="sp-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </label>
        <PasswordRules password={password} confirm={confirm} />
        <button type="submit" className="jpk-auth-submit" disabled={submitting || !current || !password}>
          <Icon name={submitting ? 'Loader2' : 'KeyRound'} size={17} className={submitting ? 'spin' : ''} />
          {submitting ? 'Saving…' : 'Save and continue'}
        </button>
        <button type="button" className="jpk-auth-signout" onClick={logout}>Sign out</button>
      </form>
    </AuthLayout>
  );
}
