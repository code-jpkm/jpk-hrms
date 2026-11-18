import React, { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ArrowLeft, Send } from '../../components/icons';
import AuthLayout from '../../components/AuthLayout';
import Captcha from '../../components/Captcha';
import T from '../../components/T';
import { Button, Field, Input, Notice } from '../../components/ui';
import { post } from '../../api/client';
import { colors } from '../../theme';

export default function ForgotPasswordScreen({ navigation }) {
  const [identifier, setIdentifier] = useState('');
  const [captcha, setCaptcha] = useState({ token: '', answer: '', required: true });
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const captchaRef = useRef(null);

  async function submit() {
    setError('');
    if (!identifier.trim()) { setError('Enter your email or employee code.'); return; }
    if (captcha.required && captcha.answer.length < 4) { setError('Type the letters from the picture.'); captchaRef.current?.focus(); return; }
    setBusy(true);
    try {
      const data = await post('/auth/forgot-password', { identifier: identifier.trim(), captchaToken: captcha.token, captchaAnswer: captcha.answer });
      setDone(data.message);
    } catch (err) {
      setError(err.message);
      captchaRef.current?.refresh({ focus: err.code === 'CAPTCHA_INVALID' });
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Pressable onPress={() => navigation.goBack()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', padding: 4 }} accessibilityRole="link">
      <ArrowLeft size={15} color={colors.navy} /><T v="strong" color={colors.navy}>Back to sign in</T>
    </Pressable>
  );

  return (
    <AuthLayout title="Forgot your password?" subtitle="We’ll send a link to choose a new one to your email and WhatsApp.">
      {done ? (
        <View style={{ gap: 14 }}><Notice tone="ok">{done}</Notice>{back}</View>
      ) : (
        <View style={{ gap: 13 }}>
          {!!error && <Notice>{error}</Notice>}
          <Field label="Email or employee code">
            <Input value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="name@company.com or JPK001" />
          </Field>
          <Captcha ref={captchaRef} onChange={setCaptcha} disabled={busy} />
          <Button title={busy ? 'Sending…' : 'Send reset link'} icon={Send} loading={busy} onPress={submit} disabled={!identifier.trim()} />
          {back}
        </View>
      )}
      <T v="small" center style={{ borderTopWidth: 1, borderTopColor: colors.gray150, paddingTop: 12 }}>No email or WhatsApp on your profile? Ask HR to send you new login details.</T>
    </AuthLayout>
  );
}
