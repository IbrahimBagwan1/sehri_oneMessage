import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
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
 *   • Expo Go on Android SDK 53+ (Google removed remote-push support
 *     from Expo Go — you need a development build for real push tokens)
 *   • denied permission (the user chose not to receive push — respect it)
 *   • missing projectId in Expo config (dev builds sometimes lack this)
 *
 * Never throws — a push-registration failure must not break sign-in.
 *
 * Loading strategy: we deliberately DO NOT `import 'expo-notifications'`
 * at the top of the file. In Expo Go on Android since SDK 53, that import
 * (and specifically Notifications.setNotificationHandler) can throw
 * synchronously, which would take down every screen that transitively
 * imports the auth store. Instead we lazy-require the module inside a
 * try/catch and treat any load failure as "push unavailable here".
 */

// -----------------------------------------------------------------------------
// Environment detection — Expo Go vs a real dev/standalone build.
//
// Constants.appOwnership === 'expo' means we're inside Expo Go.
// executionEnvironment === 'storeClient' is the newer equivalent for the
// same case. Either signal is enough — we skip push in that environment.
// -----------------------------------------------------------------------------
const isExpoGo =
  Constants.appOwnership === 'expo' ||
  Constants.executionEnvironment === 'storeClient';

// -----------------------------------------------------------------------------
// Lazy-load expo-notifications. Kept behind a function so the failure
// (if any) happens on first CALL, not at module import time. Cached
// after the first successful load.
// -----------------------------------------------------------------------------
let _notifications = null;
let _notificationsLoadFailed = false;

const loadNotifications = () => {
  if (_notifications) return _notifications;
  if (_notificationsLoadFailed) return null;
  try {
    // eslint-disable-next-line global-require
    _notifications = require('expo-notifications');
    return _notifications;
  } catch (err) {
    _notificationsLoadFailed = true;
    if (__DEV__) {
      console.log('[push] expo-notifications unavailable in this environment:', err?.message);
    }
    return null;
  }
};

// Set the foreground handler ONCE, lazily, on first use — same reason
// as above. We do NOT run this at module load.
let _handlerInstalled = false;
const ensureForegroundHandler = (Notifications) => {
  if (_handlerInstalled || !Notifications?.setNotificationHandler) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert:  true,
        shouldPlaySound:  true,
        shouldSetBadge:   false,
        shouldShowBanner: true,
        shouldShowList:   true,
      }),
    });
    _handlerInstalled = true;
  } catch (err) {
    // setNotificationHandler itself can throw in Expo Go on Android since
    // SDK 53. Swallow it — the handler is a nice-to-have.
    if (__DEV__) console.log('[push] setNotificationHandler skipped:', err?.message);
  }
};

/**
 * Request permission + fetch an Expo push token + register it with the
 * backend. Idempotent — safe to call on every launch.
 *
 * Returns the token string on success, or null on any failure (including
 * "we're inside Expo Go, remote push isn't supported here" — which is
 * fine, other push logic just no-ops).
 */
export const registerForPushNotifications = async () => {
  try {
    // Push doesn't work on simulators/emulators.
    if (!Device.isDevice) return null;

    // Expo Go on Android/iOS no longer ships the remote-push runtime.
    // Silently skip — a dev build is required to test real push.
    if (isExpoGo) {
      if (__DEV__) console.log('[push] Skipping push registration: running inside Expo Go.');
      return null;
    }

    const Notifications = loadNotifications();
    if (!Notifications) return null;

    ensureForegroundHandler(Notifications);

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
    if (__DEV__) console.log('[push] registration failed:', err?.message);
    return null;
  }
};

/**
 * Clear the backend's copy of the token — call from logout so a
 * shared device doesn't keep pushing arrival notifications to the
 * previous account. Non-fatal even in Expo Go — the PATCH itself
 * doesn't need the notifications module.
 */
export const unregisterPushNotifications = async () => {
  try { await apiClient.patch('/users/me/push-token', { token: null }); }
  catch (_) { /* noop */ }
};

/**
 * The notification that launched the app, if a tap is what opened it.
 *
 * Needed because addNotificationResponseReceivedListener only fires while
 * the app is alive. When the OS has killed the app — which for a Sehri app
 * notifying before dawn is the normal case, not the edge case — the tap
 * starts the process and there is no listener yet to hear it. This reads
 * that launch response once instead.
 *
 * Resolves null when the app was opened any other way.
 */
export const getInitialNotification = async () => {
  const Notifications = loadNotifications();
  if (!Notifications?.getLastNotificationResponseAsync) return null;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    return response?.notification?.request?.content?.data || null;
  } catch (err) {
    if (__DEV__) console.log('[push] initial notification unavailable:', err?.message);
    return null;
  }
};

/**
 * Attach a handler for tapping a notification while the app is running
 * (foreground or backgrounded). Returns an unsubscribe function — a no-op
 * unsubscribe when notifications aren't available.
 *
 * For the killed-app case use getInitialNotification above; this listener
 * is registered too late to catch it.
 */
export const onNotificationTap = (handler) => {
  const Notifications = loadNotifications();
  if (!Notifications?.addNotificationResponseReceivedListener) return () => {};
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification?.request?.content?.data;
      handler(data);
    });
    return () => sub.remove();
  } catch (err) {
    if (__DEV__) console.log('[push] tap listener skipped:', err?.message);
    return () => {};
  }
};
