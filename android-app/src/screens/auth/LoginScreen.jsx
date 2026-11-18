import React, { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { LogIn } from '../../components/icons';
import AuthLayout from '../../components/AuthLayout';
import Captcha from '../../components/Captcha';
import T from '../../components/T';
import { Button, Field, Input, Notice, PasswordInput } from '../../components/ui';
import { useAuth } from '../../state/AuthContext';
import { colors } from '../../theme';
import { serverUrl } from '../../config';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState({ token: '', answer: '', required: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const captchaRef = useRef(null);
  const passwordRef = useRef(null);

  async function submit() {
    if (busy) return;
    setError('');
    if (!serverUrl()) { navigation.navigate('Server'); return; }
    if (!identifier.trim() || !password) { setError('Enter your email (or employee code) and your password.'); return; }
    if (captcha.required && captcha.answer.length < 4) { setError('Type the letters from the picture.'); captchaRef.current?.focus(); return; }
    setBusy(true);
    try {
      await login({ identifier: identifier.trim(), password, captchaToken: captcha.token, captchaAnswer: captcha.answer });
    } catch (err) {
      setError(err.message || 'Could not sign in. Try again.');
      const wrongPicture = err.code === 'CAPTCHA_INVALID';
      if (!wrongPicture) setPassword('');
      captchaRef.current?.refresh({ focus: wrongPicture });
      if (!wrongPicture) setTimeout(() => passwordRef.current?.focus(), 60);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in to JPK HRMS" subtitle="Use your work email or employee code and your password." onServer={() => navigation.navigate('Server')}>
      <View style={{ gap: 13 }}>
        {!!error && <Notice>{error}</Notice>}
        <Field label="Email or employee code">
          <Input value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" keyboardType="email-address" placeholder="name@company.com or JPK001" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        </Field>
        <Field label="Password">
          <PasswordInput inputRef={passwordRef} value={password} onChangeText={setPassword} placeholder="Your password" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
        </Field>
        <Captcha ref={captchaRef} onChange={setCaptcha} disabled={busy} />
        <Button title={busy ? 'Signing in…' : 'Sign in'} icon={LogIn} loading={busy} onPress={submit} disabled={!identifier.trim() || !password} />
        <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={{ alignSelf: 'center', padding: 4 }} accessibilityRole="link">
          <T v="strong" color={colors.navy}>Forgot password?</T>
        </Pressable>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: colors.gray150, paddingTop: 12 }}>
        <T v="small" center style={{ lineHeight: 18 }}>
          <T v="small" weight="semibold" color={colors.ink}>First time here, or used Google sign-in before? </T>
          Google sign-in has been replaced by a password. Ask HR to send your login details, or use Forgot password.
        </T>
      </View>
    </AuthLayout>
  );
}
