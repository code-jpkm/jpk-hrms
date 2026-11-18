import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import { api } from '../../api/client.js';

/**
 * Picture captcha: the server draws 5 letters, the person types them.
 * Each picture works once; call ref.current.refresh() after every attempt.
 * onChange receives { token, answer, required }.
 */
const CaptchaField = forwardRef(function CaptchaField({ onChange, disabled = false }, ref) {
  const [picture, setPicture] = useState(null);
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef(null);
  const timer = useRef(null);

  const refresh = useCallback(async ({ focus = false } = {}) => {
    setLoading(true);
    setFailed(false);
    setAnswer('');
    try {
      const data = await api('/auth/captcha', { toast: false, cache: 'no-store' });
      setPicture(data);
      onChange?.({ token: data.token, answer: '', required: data.required !== false });
      // A picture expires after 5 minutes: fetch a fresh one shortly before.
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => refresh(), Math.max(30, (data.expiresInSeconds || 300) - 20) * 1000);
      if (focus) window.setTimeout(() => inputRef.current?.focus(), 30);
    } catch {
      setFailed(true);
      onChange?.({ token: '', answer: '', required: true });
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useImperativeHandle(ref, () => ({ refresh, focus: () => inputRef.current?.focus() }), [refresh]);

  useEffect(() => {
    refresh();
    return () => window.clearTimeout(timer.current);
  }, []);

  if (picture && picture.required === false) return null;

  function update(value) {
    const clean = value.replace(/\s+/g, '').slice(0, 8);
    setAnswer(clean);
    onChange?.({ token: picture?.token || '', answer: clean, required: true });
  }

  return (
    <div className="jpk-field">
      <span id="captcha-label">Type the letters you see</span>
      <div className="jpk-captcha">
        <div className="jpk-captcha-pic" aria-live="polite">
          {picture && !loading
            ? <img src={picture.image} alt="Security picture with 5 letters. Use the refresh button if you cannot read it." width="150" height="50" draggable="false" />
            : <span className="jpk-captcha-wait">{failed ? 'Could not load the picture' : 'Loading…'}</span>}
          <button type="button" className="icon-btn jpk-auth-iconbtn" onClick={() => refresh({ focus: true })} disabled={loading || disabled} aria-label="Show a new picture" title="New picture">
            <Icon name="RefreshCw" size={17} />
          </button>
        </div>
        <input
          ref={inputRef}
          aria-labelledby="captcha-label"
          value={answer}
          onChange={(e) => update(e.target.value)}
          placeholder="5 letters"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={8}
          required
          disabled={disabled}
        />
      </div>
      <small className="jpk-field-hint">Not case-sensitive. Can’t read it? Tap ↻ for a new picture.</small>
    </div>
  );
});

export default CaptchaField;
