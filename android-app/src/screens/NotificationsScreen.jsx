import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Bell, CheckCheck } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import { Button, Card, Empty, SkeletonCard } from '../components/ui';
import { useInbox } from '../state/InboxContext';
import { colors } from '../theme';
import { ago } from '../utils/time';

/** Website links in notifications -> app screens. */
export function routeForLink(link = '') {
  const path = String(link || '').replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0].toLowerCase();
  if (path.startsWith('/leave')) return ['Tabs', { screen: 'Leave' }];
  if (path.startsWith('/regularization')) return ['Requests'];
  if (path.startsWith('/attendance')) return ['Tabs', { screen: 'Attendance' }];
  if (path.startsWith('/payroll')) return ['Tabs', { screen: 'Pay' }];
  if (path.startsWith('/notices')) return ['Notices'];
  if (path.startsWith('/holidays')) return ['Holidays'];
  if (path.startsWith('/birthdays')) return ['Celebrations'];
  if (path.startsWith('/account')) return ['Profile'];
  return null;
}

export default function NotificationsScreen({ navigation }) {
  const { items, unread, loading, reload, markRead, markAllRead } = useInbox();
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function open(n) {
    if (!n.readAt) markRead(n._id);
    const target = routeForLink(n.link);
    if (target) navigation.navigate(...target);
  }

  return (
    <Screen
      header={<PageTopBar title="Notifications" subtitle={unread ? `${unread} unread` : 'All caught up'} />}
      onRefresh={reload}
      refreshing={false}
    >
      {unread > 0 && <Button title="Mark all as read" variant="ghost" small icon={CheckCheck} onPress={markAllRead} style={{ alignSelf: 'flex-end', marginBottom: 8 }} />}
      {loading && !items.length ? <SkeletonCard lines={4} /> : items.length ? (
        <Card padded={false}>
          {items.map((n, i) => (
            <Pressable key={n._id} onPress={() => open(n)} style={({ pressed }) => [styles.row, i && styles.line, !n.readAt && styles.unread, pressed && { opacity: 0.7 }]} accessibilityRole="button">
              <View style={[styles.dot, { backgroundColor: n.readAt ? 'transparent' : colors.orange }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="strong" numberOfLines={2}>{n.title}</T>
                {!!n.body && <T v="small" numberOfLines={3}>{n.body}</T>}
                <T v="small" color={colors.faint}>{ago(n.createdAt)}</T>
              </View>
            </Pressable>
          ))}
        </Card>
      ) : <Card><Empty icon={Bell} title="No notifications" text="Approvals, payslips and notices from HR show up here." /></Card>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, padding: 14, alignItems: 'flex-start' },
  line: { borderTopWidth: 1, borderTopColor: colors.gray150 },
  unread: { backgroundColor: '#FFF9F3' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 }
});
