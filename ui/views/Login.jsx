import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from '../lib/router.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import AuthLayout from '../components/auth/AuthLayout.jsx';
import PasswordInput from '../components/auth/PasswordInput.jsx';
import CaptchaField from '../components/auth/CaptchaField.jsx';

// Only paths inside this app (never another website) after signing in.
function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState({ token: '', answer: '', required: true });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const captchaRef = useRef(null);
  const passwordRef = useRef(null);
  const next = safeNext(params.get('next'));

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, navigate, next]);

  async function submit(event) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (captcha.required && captcha.answer.length < 4) {
      setError('Type the letters from the picture.');
      captchaRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      await login({ identifier: identifier.trim(), password, captchaToken: captcha.token, captchaAnswer: captcha.answer });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || 'Could not sign in. Try again.');
      const wrongPicture = err.code === 'CAPTCHA_INVALID';
      if (!wrongPicture) setPassword('');
      // Every picture works once: always show a new one.
      captchaRef.current?.refresh({ focus: wrongPicture });
      if (!wrongPicture) window.setTimeout(() => passwordRef.current?.focus(), 30);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Sign in to JPK HRMS" subtitle="Use your work email or employee code and your password.">
      <form className="jpk-auth-form" onSubmit={submit} noValidate>
        {error && <div className="jpk-auth-alert" role="alert"><Icon name="CircleAlert" size={16} /><span>{error}</span></div>}
        <label className="jpk-field">
          <span>Email or employee code</span>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@company.com or JPK001"
            required
            autoFocus
          />
        </label>
        <label className="jpk-field" htmlFor="login-password">
          <span>Password</span>
          <PasswordInput id="login-password" value={password} onChange={setPassword} inputRef={passwordRef} placeholder="Your password" />
        </label>
        <CaptchaField ref={captchaRef} onChange={setCaptcha} disabled={submitting} />
        <button type="submit" className="jpk-auth-submit" disabled={submitting || !identifier.trim() || !password}>
          <Icon name={submitting ? 'Loader2' : 'LogIn'} size={17} className={submitting ? 'spin' : ''} />
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="jpk-auth-links">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
      </form>
      <div className="jpk-auth-help">
        <b>First time here, or used “Continue with Google” before?</b> Google sign-in has been replaced by a password. Ask HR to send your login details, or use <Link to="/forgot-password">Forgot password</Link>.
      </div>
    </AuthLayout>
  );
}
