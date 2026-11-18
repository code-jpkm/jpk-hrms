import React, { useState } from 'react';
import { Link, useSearchParams } from '../lib/router.jsx';
import { post } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import AuthLayout from '../components/auth/AuthLayout.jsx';
import PasswordInput from '../components/auth/PasswordInput.jsx';
import PasswordRules, { passwordProblems } from '../components/auth/PasswordRules.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    const problems = passwordProblems(password);
    if (problems.length) { setError(problems[0]); return; }
    if (password !== confirm) { setError('The two passwords are not the same.'); return; }
    setSubmitting(true);
    try {
      const data = await post('/auth/reset-password', { token, password }, { toast: false });
      setDone(data.message);
    } catch (err) {
      setError(err.message || 'Could not change the password.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Reset link is incomplete" subtitle="Open the link from your email or WhatsApp message again, or ask for a new one.">
        <div className="jpk-auth-form"><Link className="jpk-auth-back" to="/forgot-password"><Icon name="ArrowLeft" size={15} /> Ask for a new link</Link></div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You’ll use it to sign in from now on.">
      {done ? (
        <div className="jpk-auth-form">
          <div className="jpk-auth-ok" role="status"><Icon name="CircleCheck" size={18} /><span>{done}</span></div>
          <Link className="jpk-auth-submit as-link" to="/login"><Icon name="LogIn" size={17} /> Sign in</Link>
        </div>
      ) : (
        <form className="jpk-auth-form" onSubmit={submit} noValidate>
          {error && <div className="jpk-auth-alert" role="alert"><Icon name="CircleAlert" size={16} /><span>{error}</span></div>}
          <label className="jpk-field" htmlFor="reset-new">
            <span>New password</span>
            <PasswordInput id="reset-new" value={password} onChange={setPassword} autoComplete="new-password" placeholder="At least 8 characters" autoFocus />
          </label>
          <label className="jpk-field" htmlFor="reset-confirm">
            <span>Type it again</span>
            <PasswordInput id="reset-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </label>
          <PasswordRules password={password} confirm={confirm} />
          <button type="submit" className="jpk-auth-submit" disabled={submitting}>
            <Icon name={submitting ? 'Loader2' : 'KeyRound'} size={17} className={submitting ? 'spin' : ''} />
            {submitting ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
