import React from 'react';
import { Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Server } from './icons';
import T from './T';
import DayScene from './DayScene';
import { colors, radius, shadow } from '../theme';
import { hostOf, serverUrl } from '../config';

/** Sign-in screens on the live time-of-day landscape, like the website. */
export default function AuthLayout({ title, subtitle, children, onServer, footer = 'Attendance · Leave · Payroll · Recruitment' }) {
  const insets = useSafeAreaInsets();
  const host = hostOf(serverUrl());
  return (
    <DayScene variant="hero" style={{ flex: 1 }}>
      {({ tone }) => (
      <>
      <StatusBar style={tone === 'dark' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={StyleSheet.absoluteFill} behavior="padding">
        <ScrollView contentContainerStyle={[styles.center, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.head}>
              <Image source={require('../../assets/jpk-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="JPK Metallics" />
              <T v="h2" center>{title}</T>
              {!!subtitle && <T v="small" center style={{ fontSize: 13.5, lineHeight: 20 }}>{subtitle}</T>}
            </View>
            {children}
          </View>
          {!!footer && <View style={styles.foot}><T style={styles.footText}>{footer}</T></View>}
          {onServer && (
            <Pressable onPress={onServer} style={styles.server} accessibilityRole="button" accessibilityLabel="Change the HRMS server address">
              <Server size={13} color="#FFFFFF" />
              <T style={styles.footText} numberOfLines={1}>{host ? `Server: ${host}` : 'Set the HRMS server address'} · Change</T>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      </>
      )}
    </DayScene>
  );
}

const styles = StyleSheet.create({
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  card: { width: '100%', maxWidth: 420, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: radius.lg, borderTopWidth: 4, borderTopColor: colors.orange, borderWidth: 1, borderColor: 'rgba(225,225,228,0.9)', padding: 22, gap: 15, ...shadow(3) },
  head: { alignItems: 'center', gap: 4 },
  logo: { width: 112, height: 56, marginBottom: 4 },
  foot: { marginTop: 14, backgroundColor: 'rgba(20,35,48,0.42)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
  footText: { color: '#FFFFFF', fontSize: 12 },
  server: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(20,35,48,0.42)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, maxWidth: '92%' }
});
