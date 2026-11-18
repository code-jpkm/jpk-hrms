import React, { useState } from 'react';
import { View } from 'react-native';
import { KeyRound } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import { Button, Card, Field, Notice, PasswordInput } from '../components/ui';
import T from '../components/T';
import { useAuth } from '../state/AuthContext';
import { passwordProblems, PasswordRules } from './auth/SetPasswordScreen';

export default function ChangePasswordScreen({ navigation }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setState(null);
    const problems = passwordProblems(password);
    if (problems.length) { setState({ ok: false, text: problems[0] }); return; }
    if (password !== confirm) { setState({ ok: false, text: 'The two new passwords are not the same.' }); return; }
    if (password === current) { setState({ ok: false, text: 'Choose a password different from the current one.' }); return; }
    setBusy(true);
    try {
      await changePassword(current, password);
      setCurrent(''); setPassword(''); setConfirm('');
      setState({ ok: true, text: 'Password changed. Other phones and browsers are signed out.' });
      setTimeout(() => navigation.canGoBack() && navigation.goBack(), 1400);
    } catch (err) {
      setState({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen header={<PageTopBar title="Change password" />} keyboard>
      <Card>
        <View style={{ gap: 13 }}>
          {state && <Notice tone={state.ok ? 'ok' : 'warn'}>{state.text}</Notice>}
          <Field label="Current password"><PasswordInput value={current} onChangeText={setCurrent} autoComplete="current-password" /></Field>
          <Field label="New password"><PasswordInput value={password} onChangeText={setPassword} placeholder="At least 8 characters" autoComplete="new-password" /></Field>
          <Field label="Type the new password again"><PasswordInput value={confirm} onChangeText={setConfirm} autoComplete="new-password" /></Field>
          <PasswordRules password={password} confirm={confirm} />
          <Button title={busy ? 'Saving…' : 'Change password'} icon={KeyRound} loading={busy} onPress={submit} disabled={!current || !password} />
          <T v="small">Changing it signs you out everywhere else, so an old phone can’t stay signed in.</T>
        </View>
      </Card>
    </Screen>
  );
}
