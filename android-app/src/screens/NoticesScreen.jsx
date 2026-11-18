import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Megaphone, Paperclip } from '../components/icons';
import Screen from '../components/Screen';
import { PageTopBar } from '../components/TopBar';
import T from '../components/T';
import { Card, Empty, Pill, SkeletonCard } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { colors } from '../theme';
import { formatDate } from '../utils/time';

export default function NoticesScreen() {
  const notices = useApi('/notices');
  const [open, setOpen] = useState(null);
  const list = notices.data?.notices || [];
  return (
    <Screen header={<PageTopBar title="Notice board" subtitle="Announcements from HR" />} onRefresh={notices.refresh} refreshing={notices.refreshing}>
      {!notices.data && !notices.error ? <SkeletonCard lines={3} /> : list.length ? list.map((n) => {
        const expanded = open === n._id;
        const body = String(n.body || n.message || n.content || '');
        return (
          <Card key={n._id} style={{ marginBottom: 12 }} onPress={() => setOpen(expanded ? null : n._id)}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Megaphone size={18} color={colors.navy} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 4 }}>
                <T v="h3">{n.title}</T>
                <T v="small">{formatDate(n.publishedAt || n.createdAt)}{n.createdByName ? ` · ${n.createdByName}` : ''}</T>
                {!!body && <T numberOfLines={expanded ? undefined : 3} style={{ marginTop: 4 }}>{body}</T>}
                {expanded && (n.attachments || []).map((a, i) => (
                  <Pressable key={i} onPress={() => a.url && Linking.openURL(a.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <Paperclip size={14} color={colors.navy} /><T v="small" color={colors.navy} weight="semibold">{a.name || a.fileName || 'Attachment'}</T>
                  </Pressable>
                ))}
              </View>
              {(n.priority === 'HIGH' || n.pinned) && <Pill label={n.pinned ? 'pinned' : 'important'} tone="warn" />}
            </View>
          </Card>
        );
      }) : <Card><Empty icon={Megaphone} title="No notices" text="Company announcements appear here." /></Card>}
    </Screen>
  );
}
