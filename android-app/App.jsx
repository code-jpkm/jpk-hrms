import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// Only the four weights the app uses (the package index would bundle all 18 files).
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { AuthProvider, useAuth } from './src/state/AuthContext';
import { InboxProvider } from './src/state/InboxContext';
import AppNavigator from './src/navigation/AppNavigator';
import { colors } from './src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: colors.navy, background: colors.bg, card: '#FFFFFF', text: colors.ink, border: colors.line, notification: colors.orange }
};

function Root({ fontsReady }) {
  const { booting } = useAuth();
  const ready = fontsReady && !booting;
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="dark" />
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <InboxProvider>
          <Root fontsReady={Boolean(fontsLoaded || fontError)} />
        </InboxProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
