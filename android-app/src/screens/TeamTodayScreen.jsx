import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ChevronLeft, ChevronRight, Search, UsersRound } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import { Avatar, Card, Empty, IconButton, Notice, SkeletonCard } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { colors, font, radius, shadow } from '../theme';
import { formatDay, formatMinutes, formatPunch, todayKey } from '../utils/time';
import { TEAM_STATES, leaveName } from '../utils/attendance';

const FILTERS = [
  { key: 'ALL', label: 'All', test: () => true },
  { key: 'PRESENT', label: 'Present', test: (r) => ['IN', 'DONE'].includes(r.state) },
  { key: 'LATE', label: 'Late', test: (r) => r.lateMinutes > 0 },
  { key: 'MISSING', label: 'Not in', test: (r) => ['MISSING', 'ABSENT'].includes(r.state) },
  { key: 'AWAY', label: 'Leave / WFH', test: (r) => ['LEAVE', 'WFH'].includes(r.state) }
];

function shiftDay(key, delta) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function detail(r) {
  if (r.state === 'IN') return `In at ${formatPunch(r.checkIn)} · ${formatMinutes(r.workedMinutes)} so far`;
  if (r.state === 'DONE') return `${formatPunch(r.checkIn)} – ${formatPunch(r.checkOut)} · ${formatMinutes(r.workedMinutes)}`;
  if (r.state === 'LEAVE' || r.state === 'WFH') return leaveName(r.leaveType || r.state);
  if (r.state === 'HOLIDAY') return r.holidayName || 'Holiday';
  if (r.state === 'NOT_YET') return r.shiftStart ? `Shift starts ${r.shiftStart}` : 'Shift not started';
  return TEAM_STATES[r.state]?.label || r.state;
}

export default function TeamTodayScreen() {
  const [date, setDate] = useState(todayKey());
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const team = useApi(`/attendance/team-today?date=${date}`);
  const data = team.data;
  const s = data?.summary || {};

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    const q = query.trim().toLowerCase();
    return (data?.rows || [])
      .filter(f.test)
      .filter((r) => !q || `${r.name} ${r.employeeCode} ${r.department}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, filter, query]);

  const counts = {
    ALL: s.total || 0,
    PRESENT: s.present || 0,
    LATE: s.late || 0,
    MISSING: s.missing || 0,
    AWAY: (s.onLeave || 0) + (s.wfh || 0)
  };

  return (
    <Screen header={<PageTopBar title="Team today" subtitle="Who is in, late, on leave or missing" />} onRefresh={team.refresh} refreshing={team.refreshing}>
      <View style={styles.dayBar}>
        <IconButton icon={ChevronLeft} label="Previous day" onPress={() => setDate(shiftDay(date, -1))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T v="h3">{date === todayKey() ? 'Today' : formatDay(date)}</T>
          {date !== todayKey() && <Pressable onPress={() => setDate(todayKey())}><T v="small" color={colors.orange} weight="semibold">Back to today</T></Pressable>}
        </View>
        <IconButton icon={ChevronRight} label="Next day" onPress={() => date < todayKey() && setDate(shiftDay(date, 1))} color={date < todayKey() ? colors.navy : colors.gray300} />
      </View>

      <View style={styles.summary}>
        <View style={styles.stat}><T v="big">{s.present ?? '–'}</T><T v="small">present</T></View>
        <View style={styles.stat}><T v="big" color={s.late ? colors.orange : colors.ink}>{s.late ?? '–'}</T><T v="small">late</T></View>
        <View style={styles.stat}><T v="big" color={s.missing ? colors.orange : colors.ink}>{s.missing ?? '–'}</T><T v="small">not in</T></View>
        <View style={styles.stat}><T v="big">{s.total ?? '–'}</T><T v="small">team</T></View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>
        {FILTERS.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }}>
            <T style={[styles.chipText, filter === f.key && { color: '#FFFFFF' }]}>{f.label} · {counts[f.key]}</T>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.search}>
        <Search size={17} color={colors.faint} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search name, code or department" placeholderTextColor={colors.faint} style={styles.searchInput} />
      </View>

      {team.error && <Notice style={{ marginBottom: 12 }}>{team.error.message}</Notice>}
      {!data && !team.error ? <SkeletonCard lines={5} /> : rows.length ? (
        <Card padded={false}>
          {rows.map((r, i) => {
            const meta = TEAM_STATES[r.state] || { label: r.state, dot: colors.gray300 };
            return (
              <View key={r.employeeId} style={[styles.row, i && styles.line]}>
                <View>
                  <Avatar name={r.name} size={38} />
                  <View style={[styles.stateDot, { backgroundColor: meta.dot }]} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <T v="strong" numberOfLines={1}>{r.name}</T>
                  <T v="small" numberOfLines={1}>{detail(r)}</T>
                  <T v="small" color={colors.faint} numberOfLines={1}>{[r.employeeCode, r.department || r.designation].filter(Boolean).join(' · ')}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <T v="small" weight="semibold" color={['MISSING', 'ABSENT'].includes(r.state) ? colors.orange : colors.navy}>{meta.label}</T>
                  {r.lateMinutes > 0 && <T v="small" color={colors.orange}>{formatMinutes(r.lateMinutes)} late</T>}
                </View>
              </View>
            );
          })}
        </Card>
      ) : <Card><Empty icon={UsersRound} title="Nobody here" text={query ? 'No one matches your search.' : 'No one in this group for the day.'} /></Card>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dayBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 4, paddingVertical: 4, ...shadow(1) },
  summary: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: 14, marginTop: 12, ...shadow(1) },
  stat: { flex: 1, alignItems: 'center' },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFFFF', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontFamily: font.semibold, fontSize: 12.5, color: colors.ink },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, height: 44, marginBottom: 12 },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 14, color: colors.ink, height: 44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  line: { borderTopWidth: 1, borderTopColor: colors.gray150 },
  stateDot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#FFFFFF' }
});
