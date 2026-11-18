import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { CheckCircle2, Circle, KeyRound } from '../../components/icons';
import AuthLayout from '../../components/AuthLayout';
import T from '../../components/T';
import { Button, Field, Notice, PasswordInput } from '../../components/ui';
import { useAuth } from '../../state/AuthContext';
import { colors } from '../../theme';

export function passwordProblems(password = '') {
  const problems = [];
  if (password.length < 8) problems.push('Use at least 8 characters.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) problems.push('Use both letters and numbers.');
  return problems;
}

export function PasswordRules({ password, confirm }) {
  const rules = [
    { ok: password.length >= 8, label: 'At least 8 characters' },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), label: 'Letters and numbers' },
    { ok: !!password && password === confirm, label: 'Both boxes match' }
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {rules.map((r) => (
        <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {r.ok ? <CheckCircle2 size={14} color={colors.green} /> : <Circle size={14} color={colors.gray400} />}
          <T v="small" color={r.ok ? colors.navy : colors.faint} weight={r.ok ? 'semibold' : 'regular'}>{r.label}</T>
        </View>
      ))}
    </View>
  );
}

/** Shown right after signing in with a temporary password from HR. */
export default function SetPasswordScreen() {
  const { user, changePassword, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    const problems = passwordProblems(password);
    if (problems.length) { setError(problems[0]); return; }
    if (password !== confirm) { setError('The two new passwords are not the same.'); return; }
    setBusy(true);
    try {
      await changePassword(current, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const first = String(user?.name || '').split(' ')[0];
  return (
    <AuthLayout title="Choose your own password" subtitle={`Welcome${first ? `, ${first}` : ''}! You signed in with a temporary password. Pick a new one to continue.`} footer={null}>
      <View style={{ gap: 13 }}>
        {!!error && <Notice>{error}</Notice>}
        <Field label="Temporary password (from HR’s message)"><PasswordInput value={current} onChangeText={setCurrent} autoComplete="current-password" /></Field>
        <Field label="New password"><PasswordInput value={password} onChangeText={setPassword} placeholder="At least 8 characters" autoComplete="new-password" /></Field>
        <Field label="Type the new password again"><PasswordInput value={confirm} onChangeText={setConfirm} autoComplete="new-password" /></Field>
        <PasswordRules password={password} confirm={confirm} />
        <Button title={busy ? 'Saving…' : 'Save and continue'} icon={KeyRound} loading={busy} onPress={submit} disabled={!current || !password} />
        <Pressable onPress={logout} style={{ alignSelf: 'center', padding: 4 }} accessibilityRole="button"><T v="small" color={colors.muted}>Sign out</T></Pressable>
      </View>
    </AuthLayout>
  );
}
