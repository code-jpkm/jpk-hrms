import React, { useState } from 'react';
import Icon from '../Icon.jsx';

/** Password box with a show / hide button. */
export default function PasswordInput({ id, value, onChange, autoComplete = 'current-password', placeholder, inputRef, required = true, ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="jpk-password">
      <input
        id={id}
        ref={inputRef}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        spellCheck={false}
        autoCapitalize="none"
        {...rest}
      />
      <button
        type="button"
        className="icon-btn jpk-auth-iconbtn"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        <Icon name={visible ? 'EyeOff' : 'Eye'} size={17} />
      </button>
    </div>
  );
}
