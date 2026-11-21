import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronLeft, ChevronRight, FilePenLine } from '../components/icons';
import Screen from '../components/Screen';
import { TabTopBar } from '../components/TopBar';
import T from '../components/T';
import Sheet from '../components/Sheet';
import { Button, Card, IconButton, NoProfile, Notice, SkeletonCard } from '../components/ui';
import { useAuth } from '../state/AuthContext';
import { useApi } from '../hooks/useApi';
import { colors, font, radius, shadow } from '../theme';
import { formatClock, formatDay, formatMinutes, formatPunch, monthKey, monthLabel, shiftMonth, WEEKDAYS } from '../utils/time';
import { isIssue, leaveName, statusMeta } from '../utils/attendance';

function Code({ status, small }) {
  const m = statusMeta(status);
  if (!m.short) return null;
  return (
    <View style={[styles.code, small && styles.codeSmall, { backgroundColor: m.bg, borderColor: m.border || m.bg }]}>
      <T style={{ color: m.fg, fontFamily: font.bold, fontSize: small ? 9.5 : 11 }}>{m.short}</T>
    </View>
  );
}

function DayCell({ day, today, onPress }) {
  if (!day) return <View style={styles.cell} />;
  const issue = isIssue(day);
  const future = ['UPCOMING', 'NOT_JOINED'].includes(day.status);
  return (
    <Pressable onPress={() => onPress(day)} disabled={future} style={styles.cell} accessibilityRole="button" accessibilityLabel={`${formatDay(day.date)}: ${statusMeta(day.status).label}`}>
      <View style={[styles.dayBox, day.date === today && styles.todayBox, issue && styles.issueBox]}>
        <T style={[styles.dayNum, future && { color: colors.gray300 }]}>{day.day}</T>
        <Code status={day.status} small />
      </View>
    </Pressable>
  );
}

function Stat({ value, label, warn }) {
  return (
    <View style={styles.stat}>
      <T v="big" color={warn && value ? colors.orange : colors.ink} style={{ fontSize: 22 }}>{value ?? 0}</T>
      <T v="small" center numberOfLines={2}>{label}</T>
    </View>
  );
}

export default function AttendanceScreen({ navigation }) {
  const { employee } = useAuth();
  const [month, setMonth] = useState(monthKey());
  const [open, setOpen] = useState(null);
  const cal = useApi(employee ? `/attendance/calendar?month=${month}` : null);
  const data = cal.data;
  const today = data?.today;

  const weeks = useMemo(() => {
    if (!data?.days?.length) return [];
    const first = data.days[0].weekday;
    const cells = Array.from({ length: first }, () => null).concat(data.days);
    while (cells.length % 7) cells.push(null);
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [data]);

  const s = data?.summary || {};
  return (
    <Screen header={<TabTopBar title="Attendance" subtitle="Your month, day by day" />} onRefresh={cal.refresh} refreshing={cal.refreshing}>
      <View style={styles.monthBar}>
        <IconButton icon={ChevronLeft} label="Previous month" onPress={() => setMonth(shiftMonth(month, -1))} />
        <T v="h3" center style={{ flex: 1 }}>{monthLabel(month)}</T>
        <IconButton icon={ChevronRight} label="Next month" onPress={() => setMonth(shiftMonth(month, 1))} />
      </View>

      {cal.error && <Notice>{cal.error.message}</Notice>}
      {!employee ? <NoProfile what="attendance" /> : !data && !cal.error ? <SkeletonCard lines={6} /> : data && (
        <>
          <Card padded={false}>
            <View style={styles.weekRow}>{WEEKDAYS.map((w) => <T key={w} v="small" center style={styles.cell}>{w.slice(0, 2)}</T>)}</View>
            {weeks.map((row, i) => (
              <View key={i} style={styles.weekRow}>{row.map((d, j) => <DayCell key={d?.date || `e${j}`} day={d} today={today} onPress={setOpen} />)}</View>
            ))}
            <View style={styles.legend}>
              {['PRESENT', 'ABSENT', 'HALF_DAY', 'REVIEW', 'LEAVE', 'HOLIDAY', 'WEEK_OFF'].map((k) => (
                <View key={k} style={styles.legendItem}><Code status={k} small /><T v="small">{statusMeta(k).label}</T></View>
              ))}
            </View>
          </Card>

          <Card style={{ marginTop: 14 }} title="This month">
            <View style={styles.stats}>
              <Stat value={s.present} label="Present" />
              <Stat value={s.absent} label="Absent" warn />
              <Stat value={s.leaveDays} label="Leave" />
              <Stat value={s.lateDays} label="Late" warn />
            </View>
            <View style={[styles.stats, { marginTop: 12 }]}>
              <Stat value={s.halfDays} label="Half days" warn />
              <Stat value={s.holidays} label="Holidays" />
              <Stat value={s.weekOffs} label="Weekly off" />
              <Stat value={s.missingPunches} label="Missing punch" warn />
            </View>
            {!!s.avgCheckIn && <T v="small" style={{ marginTop: 12 }}>Average check-in {formatClock(s.avgCheckIn)}{s.pendingRequests ? ` · ${s.pendingRequests} request(s) waiting` : ''}</T>}
          </Card>

          <Button title="Request a correction" variant="secondary" icon={FilePenLine} style={{ marginTop: 14 }} onPress={() => navigation.navigate('Requests', { create: Date.now() })} />
        </>
      )}

      <Sheet visible={!!open} onClose={() => setOpen(null)} title={open ? formatDay(open.date) : ''}
        footer={open && !['UPCOMING', 'NOT_JOINED', 'WEEK_OFF', 'HOLIDAY'].includes(open.status) ? (
          <Button title="Request a correction for this day" icon={FilePenLine} onPress={() => { const date = open.date; setOpen(null); navigation.navigate('Requests', { create: Date.now(), date }); }} />
        ) : null}
      >
        {open && (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Code status={open.status} />
              <T v="h3">{statusMeta(open.status).label}{open.leaveType ? ` · ${leaveName(open.leaveType)}` : ''}{open.holidayName ? ` · ${open.holidayName}` : ''}</T>
            </View>
            <View style={styles.facts}>
              <Fact label="Check-in" value={open.checkIn ? formatPunch(open.checkIn) : '—'} />
              <Fact label="Check-out" value={open.checkOut ? formatPunch(open.checkOut) : '—'} />
              <Fact label="Worked" value={open.workedMinutes ? formatMinutes(open.workedMinutes) : '—'} />
              <Fact label="Shift" value={open.shiftStart ? `${formatClock(open.shiftStart)} – ${formatClock(open.shiftEnd)}` : '—'} />
            </View>
            {open.lateMinutes > 0 && <Notice>Late by {formatMinutes(open.lateMinutes)}.</Notice>}
            {open.earlyLeaveMinutes > 0 && <Notice>Left {formatMinutes(open.earlyLeaveMinutes)} early.</Notice>}
            {open.status === 'REVIEW'
              ? <Notice>{open.missingSide === 'IN' ? 'Your in time' : 'Your out time'} was not recorded. HR will decide this day; until then there is no loss of pay. If you know the time, send it as a correction.</Notice>
              : open.missingPunch && <Notice>A check-in or check-out is missing for this day.</Notice>}
            {!!open.progressLabel && <T v="small">{open.progressLabel}</T>}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}

function Fact({ label, value }) {
  return (
    <View style={styles.fact}>
      <T v="eyebrow">{label}</T>
      <T v="strong">{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  monthBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, marginBottom: 12, paddingHorizontal: 4, ...shadow(1) },
  weekRow: { flexDirection: 'row', paddingHorizontal: 6 },
  cell: { width: `${100 / 7}%`, padding: 2, alignItems: 'center', paddingVertical: 6 },
  dayBox: { width: '100%', minHeight: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 3, borderWidth: 1, borderColor: 'transparent' },
  todayBox: { borderColor: colors.orange },
  issueBox: { backgroundColor: colors.orange50 },
  dayNum: { fontFamily: font.semibold, fontSize: 13.5, color: colors.navy900 },
  code: { minWidth: 26, height: 20, paddingHorizontal: 5, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  codeSmall: { minWidth: 22, height: 16, paddingHorizontal: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: colors.gray150 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fact: { width: '47%', backgroundColor: colors.gray50, borderRadius: 8, borderWidth: 1, borderColor: colors.line, padding: 10, gap: 2 }
});
