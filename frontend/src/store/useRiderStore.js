import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { trackingApi } from '../api/tracking';
import {
  requestRiderLocationPermission,
  startRiderLocationUpdates,
  stopRiderLocationUpdates,
  isRiderLocationRunning,
  pushCurrentPositionOnce,
} from '../services/riderLocationTask';

// Keys used in SecureStore — separate from user's 'access_token' so
// a rider who is also a user can stay logged in on both sessions.
const RIDER_TOKEN_KEY   = 'rider_access_token';
const RIDER_REFRESH_KEY = 'rider_refresh_token';
const RIDER_DATA_KEY    = 'rider_data';

export const useRiderStore = create((set, get) => ({
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  rider:            null,    // profile from login response
  accessToken:      null,
  isAuthenticated:  false,
  isHydrated:       false,
  deliveryList:     null,    // { poll_date, total, by_zone } or null (legacy — /delivery-list)
  loadingList:      false,
  listError:        null,

  // Multi-rider / route optimization state (from /my-stops):
  //   myStops = [{ id, location_name, packet_count, sort_order, status, latitude, longitude, has_pin, ... }]
  //   routePolyline = [{ latitude, longitude }, ...] — Google Directions polyline through pending stops
  //   stopsSummary  = { total_stops, delivered_stops, pending_stops, total_packets, delivered_packets }
  myStops:          [],
  routePolyline:    null,
  stopsSummary:     null,
  loadingStops:     false,
  stopsError:       null,

  // True while the OS-driven location task is running. Kept in state only
  // so the UI can reflect it; the task itself is owned by the OS and
  // survives this store being torn down.
  isDelivering:     false,

  // Whether the rider granted "always" location. Declared here so a
  // selector reading it before the first round gets false, not undefined.
  // A rider who declined still tracks while the app is open — we warn
  // rather than block, since refusing to let them start their round would
  // be worse than degraded tracking.
  backgroundLocationGranted: false,

  // -------------------------------------------------------------------------
  // hydrate — called once at app startup inside (rider)/_layout
  // Reads persisted token + profile from SecureStore.
  // -------------------------------------------------------------------------
  hydrate: async () => {
    try {
      const token      = await SecureStore.getItemAsync(RIDER_TOKEN_KEY);
      const riderData  = await SecureStore.getItemAsync(RIDER_DATA_KEY);
      if (token && riderData) {
        set({
          accessToken:     token,
          rider:           JSON.parse(riderData),
          isAuthenticated: true,
        });
      }
    } catch {
      // Corrupted storage — treat as logged out
    } finally {
      set({ isHydrated: true });
    }
  },

  // -------------------------------------------------------------------------
  // setRiderAuth — called after successful rider login
  // Persists tokens and profile, then updates state.
  // -------------------------------------------------------------------------
  setRiderAuth: async (rider, accessToken, refreshToken) => {
    await SecureStore.setItemAsync(RIDER_TOKEN_KEY,   accessToken);
    await SecureStore.setItemAsync(RIDER_REFRESH_KEY, refreshToken);
    await SecureStore.setItemAsync(RIDER_DATA_KEY,    JSON.stringify(rider));

    set({
      rider,
      accessToken,
      isAuthenticated: true,
    });
  },

  // -------------------------------------------------------------------------
  // riderToken — the token every rider-scoped API call is passed.
  //
  // This replaced `withRiderToken`, which swapped the shared 'access_token'
  // in SecureStore, ran the call, then put the old one back. That left a
  // window open on every request where a member-side call would have
  // authenticated as the rider — and if the app died mid-window, the
  // rider's token stayed installed as the member's, permanently.
  //
  // Reads from state, falling back to SecureStore for the background task
  // path where the store may not be hydrated.
  // -------------------------------------------------------------------------
  riderToken: async () => {
    const inState = get().accessToken;
    if (inState) return inState;
    return SecureStore.getItemAsync(RIDER_TOKEN_KEY);
  },

  // -------------------------------------------------------------------------
  // fetchDeliveryList — loads today's delivery addresses.
  // Only works if the rider is today's assigned rider.
  // -------------------------------------------------------------------------
  fetchDeliveryList: async () => {
    set({ loadingList: true, listError: null });
    try {
      const result = await trackingApi.getDeliveryList(await get().riderToken());
      if (result.success) {
        set({ deliveryList: result.data });
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to load delivery list';
      set({ listError: msg });
    } finally {
      set({ loadingList: false });
    }
  },

  // -------------------------------------------------------------------------
  // fetchMyStops — the rider's optimized route + stop queue for today.
  // Used by both the map screen (polyline + numbered markers) and the
  // deliveries screen (queue + mark-delivered actions).
  // -------------------------------------------------------------------------
  fetchMyStops: async () => {
    set({ loadingStops: true, stopsError: null });
    try {
      const result = await trackingApi.getMyStops(await get().riderToken());
      if (result.success) {
        set({
          myStops:       Array.isArray(result.data?.stops) ? result.data.stops : [],
          routePolyline: Array.isArray(result.data?.route_polyline) ? result.data.route_polyline : null,
          stopsSummary:  result.data?.summary || null,
        });
      }
    } catch (err) {
      const msg = err?.response?.data?.message || 'Failed to load stops';
      set({ stopsError: msg });
    } finally {
      set({ loadingStops: false });
    }
  },

  // -------------------------------------------------------------------------
  // markStopDelivered — optimistic update, then server confirm.
  // Refetches after the response so the polyline + optimized order
  // reflect what's left. If the API errors, roll back to whatever the
  // server currently says.
  // -------------------------------------------------------------------------
  markStopDelivered: async (stopId) => {
    const prevStops = get().myStops;
    // Optimistic
    set({
      myStops: prevStops.map((s) =>
        s.id === stopId ? { ...s, status: 'delivered', delivered_at: new Date().toISOString() } : s
      ),
    });
    try {
      await trackingApi.markStopDelivered(stopId, await get().riderToken());
      // Refetch to pick up the new sort_order + polyline.
      await get().fetchMyStops();
    } catch (err) {
      // Roll back and surface the error.
      set({ myStops: prevStops });
      throw err;
    }
  },

  // -------------------------------------------------------------------------
  // undoStopDelivered — put a stop back on the route after a mistap.
  // Optimistic like markStopDelivered, and rolls back the same way.
  // -------------------------------------------------------------------------
  undoStopDelivered: async (stopId) => {
    const prevStops = get().myStops;
    set({
      myStops: prevStops.map((s) =>
        s.id === stopId ? { ...s, status: 'pending', delivered_at: null } : s
      ),
    });
    try {
      await trackingApi.undoStopDelivered(stopId, await get().riderToken());
      await get().fetchMyStops();
    } catch (err) {
      set({ myStops: prevStops });
      throw err;
    }
  },

  // -------------------------------------------------------------------------
  // startDelivery — hand the GPS feed to the OS, then re-optimise the route
  // from the rider's real position.
  //
  // The feed is a native background task (services/riderLocationTask.js),
  // not a JS timer: a timer stops the moment the screen locks, which for a
  // 4am delivery round is nearly the whole run.
  // -------------------------------------------------------------------------
  startDelivery: async () => {
    const rider = get().rider;
    if (!rider) throw new Error('Not signed in as a rider');

    const { granted, background } = await requestRiderLocationPermission();
    if (!granted) {
      throw new Error(
        'Location permission is needed to share your position with the community. '
        + 'Enable it in Settings and try again.'
      );
    }

    const token = await get().riderToken();

    // One immediate fix so the map has something before the first
    // scheduled update lands 30 seconds later.
    try {
      await pushCurrentPositionOnce(rider, token, 'delivering');
    } catch (err) {
      console.warn('[rider] initial position push failed:', err?.message);
    }

    await startRiderLocationUpdates();
    set({ isDelivering: true, backgroundLocationGranted: background });

    // Re-optimise using the position we just pushed. Until now the order
    // was based on wherever the rider was at assignment time, which may be
    // hours old and miles away.
    try {
      await trackingApi.recomputeMyRoute(token);
      await get().fetchMyStops();
    } catch (err) {
      // Non-fatal — the existing order is still a usable route, and
      // Directions being down must not stop someone starting their round.
      console.warn('[rider] route recompute at start failed:', err?.message);
    }
  },

  // -------------------------------------------------------------------------
  // stopDelivery — stop the feed and tell the backend the run is over.
  // -------------------------------------------------------------------------
  stopDelivery: async () => {
    const rider = get().rider;
    await stopRiderLocationUpdates();
    set({ isDelivering: false });

    if (!rider) return;
    try {
      await pushCurrentPositionOnce(rider, await get().riderToken(), 'done');
    } catch (err) {
      // The feed is already stopped, so the worst case is the backend
      // showing this rider as delivering until their next sign-in, which
      // syncDeliveryState below reconciles.
      console.warn('[rider] final status push failed:', err?.message);
    }
  },

  // -------------------------------------------------------------------------
  // syncDeliveryState — reconcile on app start.
  //
  // The OS owns the location task, so it can outlive the JS context: the
  // app can be killed mid-round and relaunched with `isDelivering` reset to
  // false while the task is still running and the backend still shows the
  // rider as delivering. Without this the rider sees "Start delivery" on a
  // round that never stopped.
  // -------------------------------------------------------------------------
  syncDeliveryState: async () => {
    try {
      const running = await isRiderLocationRunning();
      const rider = get().rider;

      // Task running but nobody signed in — a leftover from a cleared
      // session. Stop it rather than pushing as a phantom rider.
      if (running && !rider) {
        await stopRiderLocationUpdates();
        set({ isDelivering: false });
        return;
      }
      if (!rider) { set({ isDelivering: false }); return; }

      // Ask the server, rather than trusting the profile persisted at
      // login — that is a snapshot and says whatever was true when they
      // signed in, which for a rider who signed in yesterday is wrong.
      let serverSaysDelivering = false;
      try {
        const res = await trackingApi.getMyRiderProfile(await get().riderToken());
        if (res?.success) {
          serverSaysDelivering = res.data.status === 'delivering';
          // Refresh the cached profile while we have the live one.
          const fresh = { ...rider, ...res.data };
          set({ rider: fresh });
          await SecureStore.setItemAsync(RIDER_DATA_KEY, JSON.stringify(fresh));
        }
      } catch {
        // Offline or the token expired. Fall back to the local signal —
        // the OS task is the more reliable of the two anyway.
      }

      set({ isDelivering: running || serverSaysDelivering });

      // The server thinks the round is live but the OS dropped our task
      // (force-stop, battery optimiser, a reboot). Restart the feed so the
      // community is not watching a rider who stopped reporting.
      if (serverSaysDelivering && !running) {
        try {
          await startRiderLocationUpdates();
        } catch (err) {
          console.warn('[rider] could not resume the location feed:', err?.message);
        }
      }
    } catch (err) {
      console.warn('[rider] delivery state sync failed:', err?.message);
    }
  },

  // -------------------------------------------------------------------------
  // logout — clears all rider state and SecureStore keys.
  // Does NOT touch the user's 'access_token' — they stay logged in.
  // -------------------------------------------------------------------------
  logout: async () => {
    // Ending the run first: the OS task outlives this store, and without
    // the 'done' push the backend would keep showing this rider as
    // mid-delivery to every member in the zone, forever.
    try { await get().stopDelivery(); } catch { /* best effort */ }

    await SecureStore.deleteItemAsync(RIDER_TOKEN_KEY);
    await SecureStore.deleteItemAsync(RIDER_REFRESH_KEY);
    await SecureStore.deleteItemAsync(RIDER_DATA_KEY);

    set({
      rider:           null,
      accessToken:     null,
      isAuthenticated: false,
      isDelivering:    false,
      deliveryList:    null,
      myStops:         [],
      routePolyline:   null,
      stopsSummary:    null,
    });
  },
}));
