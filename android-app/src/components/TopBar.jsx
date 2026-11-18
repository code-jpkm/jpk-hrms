import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Bell } from './icons';
import T from './T';
import { Avatar, IconButton } from './ui';
import { colors, shadow } from '../theme';
import { useAuth } from '../state/AuthContext';
import { useInbox } from '../state/InboxContext';

/** White top bar like the website: JPK logo, notifications bell, your initials. */
export function MainTopBar() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { unread } = useInbox();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Image source={require('../../assets/jpk-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="JPK Metallics" />
      <View style={{ flex: 1 }} />
      <IconButton icon={Bell} label={unread ? `Notifications, ${unread} unread` : 'Notifications'} badge={unread} onPress={() => navigation.navigate('Notifications')} />
      <Pressable onPress={() => navigation.navigate('Profile')} accessibilityRole="button" accessibilityLabel="My profile" hitSlop={6} style={{ marginLeft: 6 }}>
        <Avatar name={user?.name} size={34} />
      </Pressable>
    </View>
  );
}

/** Top bar for inner pages: back arrow and title. */
export function PageTopBar({ title, subtitle, right }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <IconButton icon={ArrowLeft} label="Back" onPress={() => navigation.goBack()} />
      <View style={{ flex: 1, marginLeft: 4 }}>
        <T v="h3" numberOfLines={1}>{title}</T>
        {!!subtitle && <T v="small" numberOfLines={1}>{subtitle}</T>}
      </View>
      {right}
    </View>
  );
}

/** Title bar for the main tabs (Attendance, Leave…): logo-less, with bell. */
export function TabTopBar({ title, subtitle }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { unread } = useInbox();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <View style={{ flex: 1, paddingLeft: 6 }}>
        <T v="h2" numberOfLines={1}>{title}</T>
        {!!subtitle && <T v="small" numberOfLines={1}>{subtitle}</T>}
      </View>
      <IconButton icon={Bell} label="Notifications" badge={unread} onPress={() => navigation.navigate('Notifications')} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 8, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.line, ...shadow(1), zIndex: 2 },
  logo: { width: 84, height: 40, marginLeft: 6 }
});
