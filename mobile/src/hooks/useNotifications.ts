// ─────────────────────────────────────────────────────────────────────────────
//  hooks/useNotifications.ts — Push notification registration & handling
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { router } from 'expo-router';

// Configure how notifications appear when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log('[Push] Skipping — not a physical device');
    return null;
  }

  // Check existing permissions
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  // Request if not granted
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Push] Permission not granted');
    return null;
  }

  // Android needs a notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'ברירת מחדל',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2F6FED',
    });
  }

  // Get the push token
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: projectId ?? undefined,
  });

  return tokenData.data;
}

/**
 * Hook to register for push notifications and handle taps.
 * Call once in the root layout. Provides the token via callback
 * so the caller can submit it to the backend.
 */
export function useNotifications(onToken?: (token: string) => void) {
  const responseListener = useRef<Notifications.EventSubscription>();

  useEffect(() => {
    // Register and get token
    registerForPushNotifications().then(token => {
      if (token) {
        console.log('[Push] Token:', token);
        onToken?.(token);
      }
    });

    // Handle notification taps — navigate to the relevant lawsuit
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.lawsuitId) {
        router.push({ pathname: '/lawsuit/[id]', params: { id: data.lawsuitId as string } });
      }
    });

    return () => {
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, []);
}
