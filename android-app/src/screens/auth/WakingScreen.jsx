import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import AuthLayout from '../../components/AuthLayout';
import T from '../../components/T';
import { hostOf } from '../../config';
import { colors } from '../../theme';

/** Shown while a slow (sleeping) server answers the first call. */
export default function WakingScreen() {
  return (
    <AuthLayout title="Opening JPK HRMS" subtitle={`Connecting to ${hostOf() || 'the server'}.`} footer={null}>
      <View style={{ alignItems: 'center', gap: 12, paddingVertical: 6 }}>
        <ActivityIndicator size="large" color={colors.navy} />
        <T v="small" center color={colors.muted}>If the server was asleep it can take up to a minute to wake. You stay signed in.</T>
      </View>
    </AuthLayout>
  );
}
