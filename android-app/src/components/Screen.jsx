import React from 'react';
import { KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

/** Scrolling page with pull-to-refresh and room for the tab bar. */
export default function Screen({ children, onRefresh, refreshing = false, header, padded = true, contentStyle, scroll = true, keyboard = false }) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[padded && styles.pad, { paddingBottom: 28 + (header ? 0 : insets.bottom) }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} colors={[colors.navy]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1 }, padded && styles.pad, contentStyle]}>{children}</View>;
  return (
    <View style={styles.root}>
      {header}
      {keyboard ? <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">{body}</KeyboardAvoidingView> : body}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16, paddingTop: 14 }
});
