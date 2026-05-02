// ─────────────────────────────────────────────────────────────────────────────
//  app/_layout.tsx — Root layout for Fair Together
//  Loads fonts, sets RTL, defines navigation stack
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import {
  Heebo_400Regular,
  Heebo_500Medium,
  Heebo_600SemiBold,
  Heebo_700Bold,
} from '@expo-google-fonts/heebo';
import * as SplashScreen from 'expo-splash-screen';
import { useNotifications } from '@/hooks/useNotifications';
import * as api from '@/services/api';

// Keep splash screen visible while fonts load
SplashScreen.preventAutoHideAsync();

// Force RTL for Hebrew
if (!I18nManager.isRTL) {
  I18nManager.forceRTL(true);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Heebo_400Regular,
    Heebo_500Medium,
    Heebo_600SemiBold,
    Heebo_700Bold,
  });

  // Register for push notifications and submit token to backend
  useNotifications((token) => {
    api.updatePushToken(token).catch(() => {
      // Token update failed — will retry next launch
    });
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settlement" />
      <Stack.Screen name="lawsuit" />
      <Stack.Screen name="claim" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="cases" />
      <Stack.Screen name="legal" />
    </Stack>
  );
}
