import React from 'react';
import Icon from '../Icon.jsx';

/** Same rules as the server (server/src/services/loginAccessService.js). */
export function passwordProblems(password = '') {
  const problems = [];
  if (password.length < 8) problems.push('Use at least 8 characters.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) problems.push('Use both letters and numbers.');
  return problems;
}

export default function PasswordRules({ password = '', confirm }) {
  const rules = [
    { ok: password.length >= 8, label: 'At least 8 characters' },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), label: 'Letters and numbers' },
    ...(confirm !== undefined ? [{ ok: Boolean(password) && password === confirm, label: 'Both boxes match' }] : [])
  ];
  return (
    <ul className="jpk-pw-rules" aria-label="Password rules">
      {rules.map((rule) => (
        <li key={rule.label} className={rule.ok ? 'ok' : ''}>
          <Icon name={rule.ok ? 'CircleCheck' : 'CircleDot'} size={14} /> {rule.label}
        </li>
      ))}
    </ul>
  );
}
