import React, { useState } from 'react';
import { View } from 'react-native';
import { Check, Wifi } from '../../components/icons';
import AuthLayout from '../../components/AuthLayout';
import T from '../../components/T';
import { Button, Field, Input, Notice } from '../../components/ui';
import { builtInServer, normalise, saveServer, serverUrl } from '../../config';
import { useAuth } from '../../state/AuthContext';

/** Where the HRMS lives (the same address you open in the browser). */
export default function ServerScreen({ navigation, route }) {
  const { user, logout } = useAuth();
  const [value, setValue] = useState(serverUrl() || builtInServer() || '');
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    const url = normalise(value);
    if (!url) { setState({ ok: false, text: 'Type the address, for example jpk-hrms.onrender.com' }); return null; }
    setBusy(true);
    setState({ ok: true, text: 'Checking… (a sleeping server can take up to a minute)' });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 70000);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (!data?.ok) throw new Error('not hrms');
      setState({ ok: true, text: `Connected: JPK HRMS ${data.build || ''}`.trim() });
      return url;
    } catch {
      setState({ ok: false, text: 'No JPK HRMS found at that address. Check it and try again.' });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const url = await check();
    if (!url) return;
    const changed = url !== serverUrl();
    await saveServer(url);
    // A different server has different accounts: sign out so you sign in there.
    if (user && changed) { await logout(); return; }
    if (navigation.canGoBack()) navigation.goBack();
  }

  return (
    <AuthLayout title="HRMS server" subtitle="The address you open in the browser, for example jpk-hrms.onrender.com" footer={null}>
      <View style={{ gap: 13 }}>
        {state && <Notice tone={state.ok ? 'ok' : 'warn'}>{state.text}</Notice>}
        <Field label="Server address">
          <Input value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://jpk-hrms.onrender.com" />
        </Field>
        <Button title="Check" variant="secondary" icon={Wifi} onPress={check} loading={busy} />
        <Button title="Save" icon={Check} onPress={save} disabled={busy || !value.trim()} />
        {!!builtInServer() && <T v="small" center>Built-in address: {builtInServer().replace(/^https?:\/\//, '')}</T>}
        {!!user && <T v="small" center>Saving a different address signs you out of this one.</T>}
        {navigation.canGoBack() && <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />}
      </View>
    </AuthLayout>
  );
}
