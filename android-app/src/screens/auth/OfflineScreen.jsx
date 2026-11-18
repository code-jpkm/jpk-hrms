import React, { useState } from 'react';
import { View } from 'react-native';
import { RefreshCw, Server } from '../../components/icons';
import AuthLayout from '../../components/AuthLayout';
import T from '../../components/T';
import { Button } from '../../components/ui';
import { useAuth } from '../../state/AuthContext';
import { hostOf } from '../../config';
import { colors } from '../../theme';

/** Signed in before, but the server can't be reached right now. */
export default function OfflineScreen({ navigation }) {
  const { retry, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  async function again() {
    setBusy(true);
    try { await retry(); } finally { setBusy(false); }
  }
  return (
    <AuthLayout title="Can’t reach the HRMS" subtitle={`No answer from ${hostOf() || 'the server'}. Check your internet. A sleeping server can take up to a minute to wake.`} footer={null}>
      <View style={{ gap: 12 }}>
        <Button title={busy ? 'Trying…' : 'Try again'} icon={RefreshCw} loading={busy} onPress={again} />
        <Button title="Change server address" variant="secondary" icon={Server} onPress={() => navigation.navigate('Server')} />
        <Button title="Sign out" variant="ghost" onPress={logout} />
        <T v="small" center color={colors.muted}>Your sign-in is kept. Nothing is lost.</T>
      </View>
    </AuthLayout>
  );
}
