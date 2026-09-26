import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { trackingApi } from '../api/tracking';

/**
 * riderLocationTask.js — the rider's GPS feed, running in the background.
 *
 * WHY THIS REPLACED A setInterval
 * The previous implementation asked for FOREGROUND location permission and
 * polled with setInterval every 5 seconds. Both iOS and Android suspend
 * JavaScript timers the moment the app is backgrounded or the screen locks,
 * so tracking stopped dead. A rider at 4am is riding a bike with the phone
 * in a pocket and the screen off — that is the normal case for this app, not
 * an edge case. Everything downstream (the user's live map, ETAs, proximity
 * notifications) was silently receiving nothing for most of a real run.
 *
 * expo-location's startLocationUpdatesAsync registers a NATIVE task that the
 * OS drives. It keeps running with the app backgrounded and the screen off,
 * and on Android it runs as a foreground service with a persistent
 * notification — which is both a platform requirement and the honest thing
 * to show someone whose location is being shared.
 *
 * WHY THE TASK TALKS TO THE API DIRECTLY
 * This module is imported at app start so the task is registered before the
 * OS can deliver to it, and the handler may be invoked when no React tree
 * exists at all (app killed, OS relaunches the task). So it reads the
 * rider's token straight from SecureStore rather than from the zustand
 * store, which may not be hydrated.
 *
 * UPDATE CADENCE — 30 seconds, not 5.
 * At 5s a two-hour run cost ~1,440 high-accuracy GPS fixes and ~1,440
 * on-device reverse-geocodes. The reverse-geocode is purely cosmetic (a text
 * label on the admin screen) and costs about as much as the fix itself. At
 * 30s the map still moves smoothly — the user's map interpolates between
 * points and the ETA service is throttled to 30s anyway, so a faster feed
 * bought nothing it could use.
 */

export const RIDER_LOCATION_TASK = 'onemessage-rider-location';

const RIDER_TOKEN_KEY = 'rider_access_token';
const RIDER_DATA_KEY  = 'rider_data';

// How often the OS should deliver a position. See the note above on why
// this is 30s. distanceInterval works alongside it: whichever triggers
// first wins, so a stationary rider costs almost nothing.
export const LOCATION_INTERVAL_MS = 30000;
export const LOCATION_DISTANCE_M  = 50;

// Reverse-geocoding every fix doubled the battery cost of the feed for a
// cosmetic label. Once every 5 fixes (~2.5 min) is plenty for "where is the
// rider roughly", and the backend geocodes server-side as a fallback anyway.
const GEOCODE_EVERY_N_FIXES = 5;
let fixCount = 0;
let lastAddress = null;

/**
 * The task body. Registered at module scope — TaskManager requires the
 * definition to exist before the OS delivers, including on a cold relaunch.
 */
TaskManager.defineTask(RIDER_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[riderTask] location error:', error.message);
    return;
  }
  const location = data?.locations?.[data.locations.length - 1];
  if (!location) return;

  try {
    const [token, riderRaw] = await Promise.all([
      SecureStore.getItemAsync(RIDER_TOKEN_KEY),
      SecureStore.getItemAsync(RIDER_DATA_KEY),
    ]);
    // Signed out, or the session was cleared while the task was still
    // registered. Stop the feed rather than pushing as nobody.
    if (!token || !riderRaw) {
      await stopRiderLocationUpdates();
      return;
    }
    const rider = JSON.parse(riderRaw);
    const { latitude, longitude } = location.coords;

    fixCount += 1;
    if (fixCount % GEOCODE_EVERY_N_FIXES === 1) {
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        lastAddress = place
          ? [place.name, place.street, place.district, place.city].filter(Boolean).join(', ')
          : lastAddress;
      } catch {
        // Keep whatever we had. The backend geocodes as a fallback.
      }
    }

    await trackingApi.pushLocation(
      rider.id,
      { latitude, longitude, current_address: lastAddress, status: 'delivering' },
      token
    );
  } catch (err) {
    // Never throw out of a background task — the OS treats a thrown task as
    // misbehaving and may stop scheduling it for the rest of the run.
    console.warn('[riderTask] push failed:', err?.message);
  }
});

/** Is the OS currently driving our location task? */
export const isRiderLocationRunning = async () => {
  try {
    return await Location.hasStartedLocationUpdatesAsync(RIDER_LOCATION_TASK);
  } catch {
    return false;
  }
};

/**
 * Ask for the permissions the task needs, in the order the platforms expect.
 *
 * Foreground must be granted before background can even be requested — iOS
 * shows "Allow Once / While Using" first and only offers "Always" afterwards.
 * Returns { granted, background } so the caller can explain what is missing.
 */
export const requestRiderLocationPermission = async () => {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { granted: false, background: false };

  // Background is requested but NOT required: a rider who declines still
  // gets tracking while the app is open, which is better than refusing to
  // let them start their round.
  let background = false;
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    background = bg.status === 'granted';
  } catch {
    background = false;
  }
  return { granted: true, background };
};

/**
 * Start the feed. Idempotent — starting an already-running task is a no-op
 * rather than a second subscription.
 */
export const startRiderLocationUpdates = async () => {
  if (await isRiderLocationRunning()) return true;

  await Location.startLocationUpdatesAsync(RIDER_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: LOCATION_INTERVAL_MS,
    distanceInterval: LOCATION_DISTANCE_M,
    // Without this the OS may hold updates back and deliver them in a burst,
    // which would make the user's map jump instead of move.
    pausesUpdatesAutomatically: false,
    // Android: required for background location, and it is what the rider
    // sees in their shade for the whole run. Worded so it is obvious what is
    // being shared and why.
    foregroundService: {
      notificationTitle: 'OneMessage — delivery in progress',
      notificationBody: 'Sharing your location so the community can track tonight’s delivery.',
      notificationColor: '#0D9488',
    },
    // iOS: show the blue status bar so location sharing is never invisible.
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
  });
  fixCount = 0;
  return true;
};

/** Stop the feed. Safe to call when it is not running. */
export const stopRiderLocationUpdates = async () => {
  try {
    if (await isRiderLocationRunning()) {
      await Location.stopLocationUpdatesAsync(RIDER_LOCATION_TASK);
    }
  } catch (err) {
    console.warn('[riderTask] stop failed:', err?.message);
  }
  fixCount = 0;
  lastAddress = null;
};

/** One immediate fix, for the moment the rider taps Start. */
export const pushCurrentPositionOnce = async (rider, token, status = 'delivering') => {
  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  const { latitude, longitude } = location.coords;
  await trackingApi.pushLocation(
    rider.id,
    { latitude, longitude, current_address: lastAddress, status },
    token
  );
  return { latitude, longitude };
};
