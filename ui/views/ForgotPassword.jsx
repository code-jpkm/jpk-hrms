import React, { useRef, useState } from 'react';
import { Link } from '../lib/router.jsx';
import { post } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import AuthLayout from '../components/auth/AuthLayout.jsx';
import CaptchaField from '../components/auth/CaptchaField.jsx';

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [captcha, setCaptcha] = useState({ token: '', answer: '', required: true });
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const captchaRef = useRef(null);

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
      const data = await post('/auth/forgot-password', { identifier: identifier.trim(), captchaToken: captcha.token, captchaAnswer: captcha.answer }, { toast: false });
      setDone(data.message);
    } catch (err) {
      setError(err.message || 'Could not send the link. Try again.');
      captchaRef.current?.refresh({ focus: err.code === 'CAPTCHA_INVALID' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Forgot your password?" subtitle="We’ll send a link to choose a new one to your email and WhatsApp.">
      {done ? (
        <div className="jpk-auth-form">
          <div className="jpk-auth-ok" role="status"><Icon name="CircleCheck" size={18} /><span>{done}</span></div>
          <Link className="jpk-auth-back" to="/login"><Icon name="ArrowLeft" size={15} /> Back to sign in</Link>
        </div>
      ) : (
        <form className="jpk-auth-form" onSubmit={submit} noValidate>
          {error && <div className="jpk-auth-alert" role="alert"><Icon name="CircleAlert" size={16} /><span>{error}</span></div>}
          <label className="jpk-field">
            <span>Email or employee code</span>
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="name@company.com or JPK001" required autoFocus />
          </label>
          <CaptchaField ref={captchaRef} onChange={setCaptcha} disabled={submitting} />
          <button type="submit" className="jpk-auth-submit" disabled={submitting || !identifier.trim()}>
            <Icon name={submitting ? 'Loader2' : 'Send'} size={17} className={submitting ? 'spin' : ''} />
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
          <div className="jpk-auth-links"><Link to="/login"><Icon name="ArrowLeft" size={14} /> Back to sign in</Link></div>
        </form>
      )}
      <div className="jpk-auth-help">No email or WhatsApp on your profile? Ask HR to send you new login details.</div>
    </AuthLayout>
  );
}
