import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import apiClient from '../api/client';

/**
 * pushService.js — Expo push token lifecycle.
 *
 * Called after every successful login (regular user, admin, super admin,
 * rider — anyone who receives push). Also runs when the app comes back
 * from background so a rotated token gets re-registered.
 *
 * Silently no-ops on:
 *   • simulators / web (no push support)
 *   • denied permission (the user chose not to receive push — respect it)
 *   • missing projectId in Expo config (dev builds sometimes lack this)
 *
 * Never throws — a push-registration failure must not break sign-in.
 */

// -----------------------------------------------------------------------------
// Foreground handler — set once at module load. Without this, incoming
// notifications while the app is open would be silently swallowed.
// -----------------------------------------------------------------------------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldPlaySound:  true,
    shouldSetBadge:   false,
    shouldShowBanner: true,
    shouldShowList:   true,
  }),
});

/**
 * Request permission + fetch an Expo push token + register it with the
 * backend. Idempotent — safe to call on every launch.
 *
 * Returns the token string on success, or null on any failure.
 */
export const registerForPushNotifications = async () => {
  try {
    // Push doesn't work on simulators/emulators.
    if (!Device.isDevice) return null;

    // Ask for permission (or read the previous answer).
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      const { status: asked } = await Notifications.requestPermissionsAsync();
      status = asked;
    }
    if (status !== 'granted') return null;

    // Android needs a channel before any push shows up.
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#0D9488',
        });
      } catch (_) { /* not fatal — some Android versions don't support */ }
    }

    // Get an Expo push token (needs the EAS projectId in modern SDKs).
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId ||
      Constants.expoConfig?.projectId;

    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenResp?.data;
    if (!token) return null;

    // Register with the backend. Non-fatal on failure — we'll try
    // again next launch.
    try {
      await apiClient.patch('/users/me/push-token', { token });
    } catch (_) { /* swallow — user might not yet have completed profile */ }

    return token;
  } catch (err) {
    if (__DEV__) console.log('[push] registration failed:', err.message);
    return null;
  }
};

/**
 * Clear the backend's copy of the token — call from logout so a
 * shared device doesn't keep pushing arrival notifications to the
 * previous account.
 */
export const unregisterPushNotifications = async () => {
  try { await apiClient.patch('/users/me/push-token', { token: null }); }
  catch (_) { /* noop */ }
};

/**
 * Attach a handler for tapping a notification (foreground or from
 * killed state). Returns an unsubscribe function.
 */
export const onNotificationTap = (handler) => {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification?.request?.content?.data;
    handler(data);
  });
  return () => sub.remove();
};
