import React from 'react';
import { Platform } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarCheck, House, LayoutGrid, Palmtree, Wallet } from '../components/icons';
import { useAuth } from '../state/AuthContext';
import { colors, font } from '../theme';

import LoginScreen from '../screens/auth/LoginScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ServerScreen from '../screens/auth/ServerScreen';
import SetPasswordScreen from '../screens/auth/SetPasswordScreen';
import OfflineScreen from '../screens/auth/OfflineScreen';
import WakingScreen from '../screens/auth/WakingScreen';
import HomeScreen from '../screens/HomeScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import LeaveScreen from '../screens/LeaveScreen';
import PayScreen from '../screens/PayScreen';
import MoreScreen from '../screens/MoreScreen';
import RequestsScreen from '../screens/RequestsScreen';
import HolidaysScreen from '../screens/HolidaysScreen';
import NoticesScreen from '../screens/NoticesScreen';
import CelebrationsScreen from '../screens/CelebrationsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ApprovalsScreen from '../screens/ApprovalsScreen';
import TeamTodayScreen from '../screens/TeamTodayScreen';
import OrgChartScreen from '../screens/OrgChartScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const stackOptions = {
  headerShown: false,
  animation: Platform.OS === 'android' ? 'slide_from_right' : 'default',
  contentStyle: { backgroundColor: colors.bg }
};

const TAB_ICONS = { Home: House, Attendance: CalendarCheck, Leave: Palmtree, Pay: Wallet, More: LayoutGrid };
const TAB_LABELS = { Home: 'Home', Attendance: 'Attendance', Leave: 'Leave', Pay: 'Payslips', More: 'More' };

function Tabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabel: TAB_LABELS[route.name],
        tabBarLabelStyle: { fontFamily: font.semibold, fontSize: 11, lineHeight: 14, marginTop: 2 },
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: colors.line,
          height: 64 + insets.bottom,
          paddingTop: 4,
          paddingBottom: insets.bottom + 4
        },
        tabBarIcon: ({ color, focused }) => {
          const Icon = TAB_ICONS[route.name];
          return <Icon size={22} color={focused ? colors.orange : color} strokeWidth={focused ? 2.3 : 2} />;
        },
        sceneStyle: { backgroundColor: colors.bg }
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Attendance" component={AttendanceScreen} />
      <Tab.Screen name="Leave" component={LeaveScreen} />
      <Tab.Screen name="Pay" component={PayScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, offline, checking } = useAuth();

  if (!user && checking) {
    return (
      <Stack.Navigator screenOptions={stackOptions}>
        <Stack.Screen name="Waking" component={WakingScreen} />
      </Stack.Navigator>
    );
  }

  if (!user && offline) {
    return (
      <Stack.Navigator screenOptions={stackOptions}>
        <Stack.Screen name="Offline" component={OfflineScreen} />
        <Stack.Screen name="Server" component={ServerScreen} />
      </Stack.Navigator>
    );
  }

  if (!user) {
    return (
      <Stack.Navigator screenOptions={stackOptions}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
        <Stack.Screen name="Server" component={ServerScreen} />
      </Stack.Navigator>
    );
  }

  if (user.forcePasswordChange) {
    return (
      <Stack.Navigator screenOptions={stackOptions}>
        <Stack.Screen name="SetPassword" component={SetPasswordScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={stackOptions}>
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="Requests" component={RequestsScreen} />
      <Stack.Screen name="Holidays" component={HolidaysScreen} />
      <Stack.Screen name="Notices" component={NoticesScreen} />
      <Stack.Screen name="Celebrations" component={CelebrationsScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="Approvals" component={ApprovalsScreen} />
      <Stack.Screen name="TeamToday" component={TeamTodayScreen} />
      <Stack.Screen name="OrgChart" component={OrgChartScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="Server" component={ServerScreen} />
    </Stack.Navigator>
  );
}
