import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Cake, PartyPopper } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import { Avatar, Card, Empty, SectionTitle, SkeletonCard } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { colors } from '../theme';
import { formatDate } from '../utils/time';

function when(p) {
  if (p.daysAway === 0) return 'Today';
  if (p.daysAway === 1) return 'Tomorrow';
  return formatDate(p.date, { year: false });
}

export default function CelebrationsScreen() {
  const data = useApi('/employees/birthdays?upcoming=45');
  const birthdays = (data.data?.birthdays || []).slice().sort((a, b) => a.daysAway - b.daysAway);
  const anniversaries = (data.data?.anniversaries || []).slice().sort((a, b) => a.daysAway - b.daysAway);
  const Row = ({ p, i, kind }) => (
    <View style={[styles.row, i && styles.line]}>
      <Avatar name={p.name} size={36} tone={p.daysAway === 0 ? 'orange' : 'navy'} />
      <View style={{ flex: 1 }}>
        <T v="strong" numberOfLines={1}>{p.name}</T>
        <T v="small" numberOfLines={1}>{[p.designation, p.department].filter(Boolean).join(' · ') || p.employeeCode}{kind === 'ann' && p.years ? ` · ${p.years} year${p.years === 1 ? '' : 's'}` : ''}</T>
      </View>
      <T v="small" weight="semibold" color={p.daysAway === 0 ? colors.orange : colors.muted}>{when(p)}</T>
    </View>
  );
  return (
    <Screen header={<PageTopBar title="Celebrations" subtitle="Birthdays and work anniversaries" />} onRefresh={data.refresh} refreshing={data.refreshing}>
      {!data.data && !data.error ? <SkeletonCard lines={4} /> : (
        <>
          <SectionTitle title="Birthdays" style={{ marginTop: 0 }} />
          {birthdays.length ? <Card padded={false}>{birthdays.map((p, i) => <Row key={`b${p.id}`} p={p} i={i} />)}</Card> : <Card><Empty icon={Cake} title="No birthdays coming up" /></Card>}
          <SectionTitle title="Work anniversaries" />
          {anniversaries.length ? <Card padded={false}>{anniversaries.map((p, i) => <Row key={`a${p.id}`} p={p} i={i} kind="ann" />)}</Card> : <Card><Empty icon={PartyPopper} title="No anniversaries coming up" /></Card>}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  line: { borderTopWidth: 1, borderTopColor: colors.gray150 }
});
