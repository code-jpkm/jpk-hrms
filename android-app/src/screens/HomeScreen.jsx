import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { BadgeIndianRupee, CalendarCheck, CalendarDays, Cake, ChevronRight, ClipboardCheck, Clock3, FilePenLine, LogIn, LogOut, Megaphone, PartyPopper, Plane, UsersRound } from '../components/icons';
import Screen from '../components/Screen';
import DayScene, { greetingAt, periodLine } from '../components/DayScene';
import { MainTopBar } from '../components/TopBar';
import T from '../components/T';
import { Button, Card, Notice, Pill, SectionTitle, SkeletonCard } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { post } from '../api/client';
import { useAuth } from '../state/AuthContext';
import { colors, font, radius, shadow } from '../theme';
import { formatClock, formatDate, formatDay, formatMinutes, formatPunch, money, monthLabel, todayKey } from '../utils/time';
import { leaveName } from '../utils/attendance';
import { canAccessPath, canApprove } from '../utils/permissions';

async function currentPlace() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Allow location to check in from the phone. It is used only at check-in and check-out.');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  let address = '';
  if (Platform.OS !== 'web') {
    try {
      const [p] = await Location.reverseGeocodeAsync(pos.coords);
      if (p) address = [p.name, p.street, p.city, p.region, p.postalCode].filter(Boolean).join(', ');
    } catch { /* address is optional */ }
  }
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, address };
}

function Hero({ name }) {
  return (
    <DayScene variant="hero" style={styles.hero}>
      {({ tone, period, minutes, times }) => {
        const ink = tone === 'dark' ? '#FFFFFF' : colors.ink;
        const soft = tone === 'dark' ? 'rgba(255,255,255,0.86)' : colors.text;
        return (
          <View style={styles.heroText}>
            <T style={{ color: soft, fontSize: 13.5 }}>{greetingAt(minutes)},</T>
            <T style={{ color: ink, fontFamily: font.bold, fontSize: 24, lineHeight: 30 }} numberOfLines={1}>{name}</T>
            <T style={{ color: soft, fontSize: 12.5, marginTop: 2, maxWidth: '58%' }} numberOfLines={2}>{periodLine(period, minutes, times)}</T>
          </View>
        );
      }}
    </DayScene>
  );
}

function TodayCard({ state, error, onPunched }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  if (!state) {
    return (
      <View style={{ marginTop: -26, marginHorizontal: 16 }}>
        {error ? <Card><Notice>{error.message}</Notice></Card> : <SkeletonCard lines={2} />}
      </View>
    );
  }
  const a = state.attendance;
  const shift = state.shift;
  const mobileOn = state.mobile?.enabled !== false;
  const label = state.completed
    ? `Done for today${a?.workedMinutes ? ` · ${formatMinutes(a.workedMinutes)}` : ''}`
    : state.canCheckOut
      ? `Checked in at ${formatPunch(a?.checkIn)}${state.workedMinutes ? ` · ${formatMinutes(state.workedMinutes)} so far` : ''}`
      : 'Not checked in yet';

  async function punch(kind) {
    setBusy(true);
    setMessage(null);
    try {
      const place = await currentPlace();
      const res = await post(kind === 'in' ? '/attendance/mobile-check-in' : '/attendance/mobile-check-out', place, { timeout: 45000 });
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMessage({ ok: true, text: res?.message || (kind === 'in' ? 'Checked in. Have a good day!' : 'Checked out. See you tomorrow!') });
      onPunched();
    } catch (err) {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginTop: -26, marginHorizontal: 16 }} padded={false}>
      <View style={styles.today}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="eyebrow">Today · {formatDay(state.date || todayKey())}</T>
          <T v="h3">{label}</T>
          {state.completed && (a?.checkIn || a?.checkOut) && <T v="small">In {formatPunch(a?.checkIn)} · Out {formatPunch(a?.checkOut)}</T>}
          {shift && <T v="small">{shift.name} · {formatClock(shift.startTime)} – {formatClock(shift.endTime)}{state.lateMinutes ? ` · ${formatMinutes(state.lateMinutes)} late` : ''}</T>}
        </View>
        <View style={[styles.todayIcon, state.canCheckOut && { backgroundColor: colors.orange50 }]}>
          <Clock3 size={20} color={state.canCheckOut ? colors.orange : colors.navy} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
        {!!state.notice && <Notice>{state.notice}</Notice>}
        {message && <Notice tone={message.ok ? 'ok' : 'warn'}>{message.text}</Notice>}
        {!mobileOn ? (
          <T v="small">Phone check-in is off for you. Use the attendance machine.</T>
        ) : state.completed ? null : state.canCheckOut ? (
          <Button title="Check out" icon={LogOut} variant="accent" loading={busy} onPress={() => punch('out')} />
        ) : state.canCheckIn ? (
          <Button title="Check in" icon={LogIn} loading={busy} onPress={() => punch('in')} />
        ) : null}
        {mobileOn && !state.completed && (state.canCheckIn || state.canCheckOut) && <T v="small" center>Your location is checked once, only when you tap.</T>}
      </View>
    </Card>
  );
}

function Tile({ icon: Icon, label, onPress, count, tone = 'navy' }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.navy25 }]} accessibilityRole="button" accessibilityLabel={count ? `${label}, ${count} waiting` : label}>
      <View style={[styles.tileIcon, tone === 'orange' && { backgroundColor: colors.orange50 }]}>
        <Icon size={20} color={tone === 'orange' ? colors.orange : colors.navy} />
        {!!count && <View style={styles.tileBadge}><T style={styles.tileBadgeText}>{count}</T></View>}
      </View>
      <T style={styles.tileLabel} numberOfLines={2}>{label}</T>
    </Pressable>
  );
}

export default function HomeScreen({ navigation }) {
  const { user, employee } = useAuth();
  const home = useApi('/dashboard/home');
  const mobile = useApi(employee ? '/attendance/mobile-state' : null);
  const data = home.data;
  const me = data?.me || {};
  const team = data?.team;
  const approvals = (team?.pending?.leave || 0) + (team?.pending?.regularization || 0);
  const name = employee?.firstName || String(user?.name || '').split(' ')[0] || '';
  const go = (route, params) => navigation.navigate(route, params);

  const tiles = [
    { icon: Plane, label: 'Apply leave', onPress: () => go('Tabs', { screen: 'Leave', params: { apply: Date.now() } }) },
    { icon: FilePenLine, label: 'Correction', onPress: () => go('Requests') },
    { icon: BadgeIndianRupee, label: 'Payslips', onPress: () => go('Tabs', { screen: 'Pay' }) },
    { icon: CalendarDays, label: 'Holidays', onPress: () => go('Holidays') },
    { icon: Megaphone, label: 'Notices', onPress: () => go('Notices') },
    { icon: PartyPopper, label: 'Celebrations', onPress: () => go('Celebrations') }
  ];
  if (canApprove(user)) tiles.splice(2, 0, { icon: ClipboardCheck, label: 'Approvals', onPress: () => go('Approvals'), count: approvals, tone: 'orange' });
  if (team && canAccessPath(user, '/attendance')) tiles.splice(3, 0, { icon: UsersRound, label: 'Team today', onPress: () => go('TeamToday') });

  return (
    <Screen header={<MainTopBar />} padded={false} onRefresh={() => { home.refresh(); mobile.refresh(); }} refreshing={home.refreshing}>
      <Hero name={name} />
      {employee ? <TodayCard state={mobile.data} error={mobile.error} onPunched={() => { mobile.reload(); home.reload(); }} /> : <View style={{ height: 8 }} />}

      <View style={styles.pad}>
        {home.error && <Notice style={{ marginTop: 14 }}>{home.error.message}</Notice>}
        <View style={styles.tiles}>
          {tiles.slice(0, 8).map((t) => <Tile key={t.label} {...t} />)}
        </View>

        {team && (
          <>
            <SectionTitle title="My team today" action="Open" onAction={() => go('TeamToday')} />
            <Card onPress={() => go('TeamToday')}>
              <View style={styles.stats}>
                <View style={styles.stat}><T v="big">{team.checkedIn}</T><T v="small">checked in</T></View>
                <View style={styles.stat}><T v="big">{team.size}</T><T v="small">in team</T></View>
                <View style={styles.stat}><T v="big" color={team.late?.length ? colors.orange : colors.ink}>{team.late?.length || 0}</T><T v="small">late</T></View>
                <View style={styles.stat}><T v="big" color={approvals ? colors.orange : colors.ink}>{approvals}</T><T v="small">to approve</T></View>
              </View>
            </Card>
          </>
        )}

        {!!me.balances?.length && (
          <>
            <SectionTitle title="Leave balance" action="Leave" onAction={() => go('Tabs', { screen: 'Leave' })} />
            <View style={styles.balances}>
              {me.balances.map((b) => (
                <View key={b.leaveType} style={styles.balance}>
                  <T v="big">{Number(b.available || 0)}</T>
                  <T v="small" numberOfLines={1}>{leaveName(b.leaveType)}</T>
                </View>
              ))}
            </View>
          </>
        )}

        {(me.pending?.leave > 0 || me.pending?.regularization > 0) && (
          <Notice tone="ok" style={{ marginTop: 14 }}>
            Waiting for approval: {[me.pending.leave ? `${me.pending.leave} leave` : '', me.pending.regularization ? `${me.pending.regularization} correction` : ''].filter(Boolean).join(', ')}.
          </Notice>
        )}

        {me.latestSlip && (
          <>
            <SectionTitle title="Latest payslip" action="All payslips" onAction={() => go('Tabs', { screen: 'Pay' })} />
            <Card onPress={() => go('Tabs', { screen: 'Pay' })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.tileIcon}><BadgeIndianRupee size={20} color={colors.navy} /></View>
                <View style={{ flex: 1 }}>
                  <T v="strong">{monthLabel(me.latestSlip.month)}</T>
                  <T v="small">Net pay {money(me.latestSlip.netPay)}</T>
                </View>
                <ChevronRight size={18} color={colors.gray400} />
              </View>
            </Card>
          </>
        )}

        {!!data?.celebrations?.length && (
          <>
            <SectionTitle title="Celebrations" action="All" onAction={() => go('Celebrations')} />
            <Card>
              {data.celebrations.slice(0, 4).map((c, i) => (
                <View key={`${c.name}-${i}`} style={[styles.row, i && styles.rowLine]}>
                  <Cake size={18} color={colors.orange} />
                  <T style={{ flex: 1 }} numberOfLines={1}><T v="strong">{c.isMe ? 'You' : c.name}</T> · {c.type === 'ANNIVERSARY' ? `${c.years ? `${c.years} year${c.years === 1 ? '' : 's'} at JPK` : 'work anniversary'}` : 'birthday'}</T>
                  <T v="small" color={c.daysAway === 0 ? colors.orange : colors.muted}>{c.daysAway === 0 ? 'Today' : c.daysAway === 1 ? 'Tomorrow' : formatDate(c.date, { year: false })}</T>
                </View>
              ))}
            </Card>
          </>
        )}

        {!!data?.holidays?.length && (
          <>
            <SectionTitle title="Coming holidays" action="All" onAction={() => go('Holidays')} />
            <Card>
              {data.holidays.slice(0, 3).map((h, i) => (
                <View key={`${h.name}-${i}`} style={[styles.row, i && styles.rowLine]}>
                  <CalendarCheck size={18} color={colors.navy} />
                  <T v="strong" style={{ flex: 1 }} numberOfLines={1}>{h.name}</T>
                  <T v="small">{formatDay(h.date)}</T>
                </View>
              ))}
            </Card>
          </>
        )}

        {!!data?.notices?.length && (
          <>
            <SectionTitle title="Notices" action="All" onAction={() => go('Notices')} />
            <Card>
              {data.notices.slice(0, 3).map((n, i) => (
                <Pressable key={n._id || i} onPress={() => go('Notices')} style={[styles.row, i && styles.rowLine]}>
                  <Megaphone size={18} color={colors.navy} />
                  <View style={{ flex: 1 }}>
                    <T v="strong" numberOfLines={1}>{n.title}</T>
                    <T v="small" numberOfLines={1}>{formatDate(n.publishedAt || n.createdAt)}</T>
                  </View>
                  {n.priority === 'HIGH' && <Pill label="Important" tone="warn" />}
                </Pressable>
              ))}
            </Card>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 16 },
  hero: { height: 178, marginHorizontal: 0 },
  heroText: { position: 'absolute', left: 18, top: 18, right: 18 },
  today: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  todayIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 16, backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: 8, ...shadow(1) },
  tile: { width: '25%', alignItems: 'center', paddingVertical: 10, gap: 6, borderRadius: 10 },
  tileIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: font.medium, fontSize: 12, color: colors.ink, textAlign: 'center', paddingHorizontal: 2 },
  tileBadge: { position: 'absolute', top: -5, right: -7, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 2, borderColor: '#FFFFFF' },
  tileBadgeText: { color: '#FFFFFF', fontFamily: font.bold, fontSize: 9.5, lineHeight: 12 },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  balances: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  balance: { flexGrow: 1, minWidth: '30%', backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 2, ...shadow(1) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.gray150 }
});
