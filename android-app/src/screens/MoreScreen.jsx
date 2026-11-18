import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  BadgeIndianRupee, Cake, CalendarCheck, CalendarDays, CircleUser, ClipboardCheck, Clock, ExternalLink, FileClock, FileText,
  Fingerprint, LayoutDashboard, Megaphone, Network, Palmtree, PlugZap, SendHorizontal, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, UserPlus, Users, UsersRound
} from '../components/icons';
import Screen from '../components/Screen';
import { TabTopBar } from '../components/TopBar';
import T from '../components/T';
import { useAuth } from '../state/AuthContext';
import { serverUrl } from '../config';
import { colors, font, radius, shadow } from '../theme';
import { canAccessPath, canApprove, hasAbility } from '../utils/permissions';

/** Same groups as the website's 9-dot menu. App screens open here; the rest open the website. */
function groupsFor(user) {
  const role = String(user?.role || '').toUpperCase();
  const isEmployee = role === 'EMPLOYEE';
  const teamToday = ['SUPER_ADMIN', 'HR_ADMIN', 'MANAGER'].includes(role) || hasAbility(user, 'ATTENDANCE', 'APPROVE');
  const can = (path) => canAccessPath(user, path);
  return [
    {
      title: 'My work',
      items: [
        { label: isEmployee ? 'My attendance' : 'Attendance', icon: CalendarCheck, route: ['Tabs', { screen: 'Attendance' }] },
        { label: 'Leave', icon: Palmtree, route: ['Tabs', { screen: 'Leave' }] },
        { label: 'Attendance correction', icon: FileClock, route: ['Requests'] },
        { label: 'My payslips', icon: BadgeIndianRupee, route: ['Tabs', { screen: 'Pay' }] },
        { label: 'Holidays', icon: CalendarDays, route: ['Holidays'] },
        { label: 'Notice board', icon: Megaphone, route: ['Notices'] },
        { label: 'Celebrations', icon: Cake, route: ['Celebrations'] },
        { label: 'My profile', icon: CircleUser, route: ['Profile'] }
      ]
    },
    {
      title: 'My team',
      items: [
        canApprove(user) && { label: 'Approvals', icon: ClipboardCheck, route: ['Approvals'] },
        teamToday && can('/attendance') && { label: 'Team today', icon: UsersRound, route: ['TeamToday'] }
      ].filter(Boolean)
    },
    {
      title: 'On the website',
      note: 'These open the full website. Sign in there once with the same email and password.',
      items: [
        !isEmployee && { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
        can('/employees') && { label: 'Employees', icon: Users, path: '/employees' },
        can('/hierarchy') && { label: 'Organisation chart', icon: Network, path: '/hierarchy' },
        can('/recruitment') && { label: 'Recruitment', icon: UserPlus, path: '/recruitment' },
        can('/probation') && { label: 'Probation', icon: ClipboardCheck, path: '/probation' },
        can('/document-studio') && { label: 'Letters & documents', icon: FileText, path: '/document-studio' },
        can('/shifts') && { label: 'Shifts', icon: Clock, path: '/shifts' },
        can('/attendance-rules') && { label: 'Attendance rules', icon: SlidersHorizontal, path: '/attendance-rules' },
        can('/biometric') && { label: 'Attendance machines', icon: Fingerprint, path: '/biometric' },
        can('/messages') && { label: 'Send a message', icon: SendHorizontal, path: '/messages' },
        can('/access') && { label: 'User access', icon: ShieldCheck, path: '/access' },
        can('/settings') && { label: 'Company settings', icon: Settings2, path: '/settings' },
        can('/integrations') && { label: 'Email, WhatsApp & AI', icon: PlugZap, path: '/integrations' },
        can('/ai') && { label: 'AI assistant', icon: Sparkles, path: '/ai' }
      ].filter(Boolean)
    }
  ].filter((g) => g.items.length);
}

function Tile({ item, onPress }) {
  const Icon = item.icon;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.navy25 }]} accessibilityRole="button" accessibilityLabel={item.path ? `${item.label}, opens the website` : item.label}>
      <View style={[styles.tileIcon, item.path && { backgroundColor: colors.gray50 }]}>
        <Icon size={21} color={colors.navy} />
        {!!item.path && <View style={styles.webMark}><ExternalLink size={9} color="#FFFFFF" /></View>}
      </View>
      <T style={styles.tileLabel} numberOfLines={2}>{item.label}</T>
    </Pressable>
  );
}

export default function MoreScreen({ navigation }) {
  const { user } = useAuth();
  const groups = groupsFor(user);
  const open = (item) => (item.route ? navigation.navigate(...item.route) : WebBrowser.openBrowserAsync(`${serverUrl()}${item.path}`));
  return (
    <Screen header={<TabTopBar title="All modules" subtitle="Everything you can open" />}>
      {groups.map((g, gi) => (
        <View key={g.title} style={{ marginTop: gi ? 18 : 0 }}>
          <T v="eyebrow" style={{ marginBottom: 8 }}>{g.title}</T>
          <View style={styles.grid}>
            {g.items.map((item) => <Tile key={item.label} item={item} onPress={() => open(item)} />)}
          </View>
          {!!g.note && <T v="small" style={{ marginTop: 8 }}>{g.note}</T>}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#FFFFFF', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: 8, ...shadow(1) },
  tile: { width: '33.333%', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, gap: 7, borderRadius: 10 },
  tileIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.navy50, alignItems: 'center', justifyContent: 'center' },
  webMark: { position: 'absolute', right: -4, bottom: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  tileLabel: { fontFamily: font.medium, fontSize: 12, color: colors.ink, textAlign: 'center' }
});
