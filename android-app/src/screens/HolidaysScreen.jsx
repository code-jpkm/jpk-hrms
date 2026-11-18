import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CalendarDays } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import { Card, Empty, Pill, SectionTitle, SkeletonCard } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { colors, font } from '../theme';
import { formatDay, todayKey } from '../utils/time';

export default function HolidaysScreen() {
  const holidays = useApi('/holidays');
  const today = todayKey();
  const list = (holidays.data?.holidays || []).map((h) => ({ ...h, key: String(h.date).slice(0, 10) })).sort((a, b) => a.key.localeCompare(b.key));
  const coming = list.filter((h) => h.key >= today);
  const past = list.filter((h) => h.key < today).reverse();

  const Row = ({ h, i }) => (
    <View style={[styles.row, i && styles.line]}>
      <View style={styles.date}>
        <T style={{ fontFamily: font.bold, fontSize: 17, color: colors.navy }}>{Number(h.key.slice(8))}</T>
        <T style={{ fontSize: 10.5, color: colors.faint, fontFamily: font.semibold }}>{formatDay(h.key).split(' ')[2]}</T>
      </View>
      <View style={{ flex: 1 }}>
        <T v="strong">{h.name}</T>
        <T v="small">{formatDay(h.key).split(',')[0]}{h.location && h.location !== 'ALL' ? ` · ${h.location}` : ''}</T>
      </View>
      {h.optional && <Pill label="optional" tone="muted" />}
      {h.key === today && <Pill label="today" tone="warn" />}
    </View>
  );

  return (
    <Screen header={<PageTopBar title="Holidays" subtitle="Company holiday list" />} onRefresh={holidays.refresh} refreshing={holidays.refreshing}>
      {!holidays.data && !holidays.error ? <SkeletonCard lines={4} /> : !list.length ? <Card><Empty icon={CalendarDays} title="No holidays added yet" /></Card> : (
        <>
          <SectionTitle title={`Coming up · ${coming.length}`} style={{ marginTop: 0 }} />
          {coming.length ? <Card padded={false}>{coming.map((h, i) => <Row key={h._id || h.key} h={h} i={i} />)}</Card> : <Card><T v="small">No more holidays this year.</T></Card>}
          {!!past.length && (
            <>
              <SectionTitle title="Earlier this year" />
              <Card padded={false} style={{ opacity: 0.8 }}>{past.map((h, i) => <Row key={h._id || h.key} h={h} i={i} />)}</Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  line: { borderTopWidth: 1, borderTopColor: colors.gray150 },
  date: { width: 44, height: 46, borderRadius: 10, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' }
});
