import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Inbox } from './icons';
import T from './T';
import { colors, font, radius, shadow } from '../theme';

export function Card({ title, right, children, style, padded = true, onPress }) {
  const body = (
    <>
      {(title || right) && (
        <View style={styles.cardHead}>
          {typeof title === 'string' ? <T v="h3" style={{ flex: 1 }}>{title}</T> : <View style={{ flex: 1 }}>{title}</View>}
          {right}
        </View>
      )}
      <View style={padded ? styles.cardBody : null}>{children}</View>
    </>
  );
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}>{body}</Pressable>;
  }
  return <View style={[styles.card, style]}>{body}</View>;
}

export function Button({ title, onPress, variant = 'primary', icon: Icon, disabled, loading, small, style, accessibilityLabel }) {
  const v = BUTTON[variant] || BUTTON.primary;
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [styles.btn, small && styles.btnSmall, { backgroundColor: v.bg, borderColor: v.border }, pressed && !off && { backgroundColor: v.pressed }, off && styles.btnOff, style]}
    >
      {loading ? <ActivityIndicator size="small" color={v.fg} /> : Icon ? <Icon size={small ? 15 : 17} color={v.fg} strokeWidth={2.2} /> : null}
      {!!title && <T style={{ color: v.fg, fontFamily: font.semibold, fontSize: small ? 13 : 14.5 }}>{title}</T>}
    </Pressable>
  );
}

const BUTTON = {
  primary: { bg: colors.navy, fg: '#FFFFFF', border: colors.navy, pressed: colors.navy600 },
  accent: { bg: colors.orange, fg: '#FFFFFF', border: colors.orange, pressed: colors.orange600 },
  secondary: { bg: '#FFFFFF', fg: colors.navy900, border: colors.line, pressed: colors.gray50 },
  ghost: { bg: 'transparent', fg: colors.navy, border: 'transparent', pressed: colors.navy50 },
  danger: { bg: colors.orange50, fg: colors.orangeText, border: colors.orange200, pressed: colors.orange100 }
};

export function IconButton({ icon: Icon, onPress, label, color = colors.navy, size = 20, badge, style }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.navy50 }, style]}>
      <Icon size={size} color={color} strokeWidth={2} />
      {badge ? <View style={styles.badge}><T style={styles.badgeText}>{badge > 99 ? '99+' : badge}</T></View> : null}
    </Pressable>
  );
}

export function Pill({ label, tone = 'muted', style }) {
  const t = PILL[tone] || PILL.muted;
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border || t.bg }, style]}>
      <T style={{ color: t.fg, fontFamily: font.semibold, fontSize: 11.5 }}>{label}</T>
    </View>
  );
}

const PILL = {
  ok: { bg: colors.greenSoft, fg: colors.green },
  navy: { bg: colors.navy50, fg: colors.navy },
  warn: { bg: colors.orange50, fg: colors.orangeText, border: colors.orange200 },
  bad: { bg: colors.orange100, fg: '#A45210' },
  muted: { bg: colors.gray100, fg: colors.gray700 }
};

export function statusTone(status) {
  const s = String(status || '').toUpperCase();
  if (['APPROVED', 'RELEASED', 'SENT', 'PAID', 'ACTIVE'].includes(s)) return 'ok';
  if (['PENDING', 'WAITING'].includes(s)) return 'warn';
  if (['REJECTED', 'FAILED'].includes(s)) return 'bad';
  return 'muted';
}

export function Field({ label, hint, error, children, style }) {
  return (
    <View style={[styles.field, style]}>
      {!!label && <T v="label">{label}</T>}
      {children}
      {!!error && <T v="small" color={colors.orangeText}>{error}</T>}
      {!error && !!hint && <T v="small">{hint}</T>}
    </View>
  );
}

export function Input({ style, inputRef, multiline, onFocus, onBlur, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={inputRef}
      placeholderTextColor={colors.gray400}
      multiline={multiline}
      {...rest}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[styles.input, multiline && styles.textarea, focused && styles.inputFocus, style]}
    />
  );
}

export function PasswordInput({ value, onChangeText, inputRef, ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <Input
        inputRef={inputRef}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ paddingRight: 46 }}
        {...rest}
      />
      <Pressable onPress={() => setVisible((v) => !v)} accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} hitSlop={6} style={styles.eye}>
        {visible ? <EyeOff size={18} color={colors.gray600} /> : <Eye size={18} color={colors.gray600} />}
      </Pressable>
    </View>
  );
}

export function Notice({ tone = 'warn', children, style }) {
  const ok = tone === 'ok';
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <View style={[styles.notice, ok ? styles.noticeOk : styles.noticeWarn, style]} accessibilityRole="alert">
      <Icon size={17} color={ok ? colors.navy : colors.orange700} />
      <T style={{ flex: 1, color: ok ? colors.ink : colors.orange700, fontSize: 13.5, lineHeight: 19 }}>{children}</T>
    </View>
  );
}

export function Empty({ title = 'Nothing here yet', text, icon: Icon = Inbox, action }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Icon size={22} color={colors.navy400} /></View>
      <T v="strong" center>{title}</T>
      {!!text && <T v="small" center style={{ maxWidth: 280 }}>{text}</T>}
      {action}
    </View>
  );
}

/** For a sign-in that is not linked to an employee record (for example a pure admin login). */
export function NoProfile({ what = 'this' }) {
  return (
    <Card>
      <Empty title="No employee profile" text={`Your sign-in is not linked to an employee record, so there is no ${what} to show. HR can link it from Employees on the website.`} />
    </Card>
  );
}

export function SectionTitle({ title, action, onAction, style }) {
  return (
    <View style={[styles.section, style]}>
      <T v="eyebrow" style={{ flex: 1 }}>{title}</T>
      {!!action && <Pressable onPress={onAction} hitSlop={8}><T v="small" color={colors.navy} weight="semibold">{action}</T></Pressable>}
    </View>
  );
}

export function Avatar({ name = '', size = 36, tone = 'navy' }) {
  const initials = String(name).split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';
  const bg = tone === 'orange' ? colors.orange : colors.navy;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ color: '#FFFFFF', fontFamily: font.semibold, fontSize: size * 0.38 }}>{initials}</T>
    </View>
  );
}

export function Divider({ style }) {
  return <View style={[{ height: 1, backgroundColor: colors.gray150 }, style]} />;
}

export function Loading({ label = 'Loading…' }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.navy} />
      <T v="small">{label}</T>
    </View>
  );
}

export function Skeleton({ height = 14, width = '100%', style }) {
  return <View style={[{ height, width, borderRadius: 6, backgroundColor: colors.gray150 }, style]} />;
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <View style={[styles.card, { padding: 16, gap: 10 }]}>
      <Skeleton width="45%" height={16} />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} width={`${90 - i * 12}%`} />)}
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, ...shadow(1) },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.gray150 },
  cardBody: { padding: 16 },
  pressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  btn: { minHeight: 46, borderRadius: 8, borderWidth: 1, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnSmall: { minHeight: 36, paddingHorizontal: 12, borderRadius: 7 },
  btnOff: { opacity: 0.55 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 3, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.orange, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  badgeText: { color: '#FFFFFF', fontFamily: font.bold, fontSize: 9.5, lineHeight: 12 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1 },
  field: { gap: 6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: '#FFFFFF', color: colors.navy900, fontFamily: font.regular, fontSize: 15 },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  inputFocus: { borderColor: colors.navy },
  eye: { position: 'absolute', right: 4, top: 0, bottom: 0, width: 40, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', padding: 12, borderRadius: 8, borderWidth: 1 },
  noticeWarn: { backgroundColor: colors.orange50, borderColor: colors.orange200 },
  noticeOk: { backgroundColor: colors.navy50, borderColor: colors.navy100 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 16 },
  emptyIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  section: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 10 },
  loading: { padding: 28, alignItems: 'center', gap: 10 }
});
