import React from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from './icons';
import T from './T';
import { IconButton } from './ui';
import { colors, radius, shadow } from '../theme';

/** Slide-up panel for forms and pickers. */
export default function Sheet({ visible, onClose, title, children, footer }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.grip} />
          <View style={styles.head}>
            <T v="h2" style={{ flex: 1 }}>{title}</T>
            <IconButton icon={X} label="Close" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>{children}</ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,35,48,0.45)' },
  panel: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '92%', borderTopWidth: 4, borderTopColor: colors.orange, ...shadow(3) },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.gray200, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 8, paddingTop: 4 },
  body: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 12, gap: 14 },
  footer: { paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.gray150, gap: 8 }
});
