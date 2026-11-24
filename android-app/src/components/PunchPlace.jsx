import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { ExternalLink, MapPin } from './icons';
import T from './T';
import { colors, font, radius } from '../theme';
import { formatPunch } from '../utils/time';

/** Where a phone punch was made: the exact point, how accurate it was, and Google Maps. */
export default function PunchPlace({ label, place, compact = false }) {
  if (!place) return null;
  const point = `${Number(place.lat).toFixed(6)}, ${Number(place.lng).toFixed(6)}`;
  const extra = [
    place.accuracy !== null && place.accuracy !== undefined ? `±${place.accuracy} m` : '',
    place.siteName || place.address || ''
  ].filter(Boolean).join(' · ');
  const open = () => Linking.openURL(place.mapUrl).catch(() => {});
  if (compact) {
    return (
      <Pressable onPress={open} style={styles.chip} accessibilityRole="link" accessibilityLabel={`${label}: ${point}. Open in Google Maps`}>
        <MapPin size={12} color={colors.navy} />
        <T style={styles.chipText}>{label}</T>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={open} style={styles.row} accessibilityRole="link" accessibilityLabel={`${label}: ${point}. Open in Google Maps`}>
      <MapPin size={18} color={colors.navy} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="strong">{label}{place.at ? ` · ${formatPunch(place.at)}` : ''}</T>
        <T v="small">{point}{extra ? ` · ${extra}` : ''}</T>
      </View>
      <View style={styles.open}>
        <T style={styles.openText}>Maps</T>
        <ExternalLink size={13} color={colors.orange} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFFFF' },
  open: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  openText: { fontFamily: font.semibold, fontSize: 12.5, color: colors.orange },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 24, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFFFF' },
  chipText: { fontFamily: font.semibold, fontSize: 11.5, color: colors.navy }
});
