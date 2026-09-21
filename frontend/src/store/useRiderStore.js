import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import { trackingApi } from '../api/tracking';

// Keys used in SecureStore — separate from user's 'access_token' so
// a rider who is also a user can stay logged in on both sessions.
const RIDER_TOKEN_KEY   = 'rider_access_token';
const RIDER_REFRESH_KEY = 'rider_refresh_token';
const RIDER_DATA_KEY    = 'rider_data';

// How often the rider's GPS is pushed to the backend (milliseconds).
const PUSH_INTERVAL_MS = 5000;

export const useRiderStore = create((set, get) => ({
  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  rider:            null,    // profile from login response
  accessToken:      null,
  isAuthenticated:  false,
  isHydrated:       false,
  isDelivering:     false,
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

  // Internal — interval handle for the GPS push loop
  _pushInterval:    null,

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
  // withRiderToken — swaps the apiClient's active token to the rider token,
  // runs the given async fn, then restores the previous token.
  //
  // This is needed because apiClient's interceptor always reads 'access_token'
  // from SecureStore. A rider who is also a regular user has two tokens — we
  // must not overwrite the user's token permanently.
  // -------------------------------------------------------------------------
  withRiderToken: async (fn) => {
    const riderToken = get().accessToken;
    const prevToken  = await SecureStore.getItemAsync('access_token');

    try {
      await SecureStore.setItemAsync('access_token', riderToken);
      return await fn();
    } finally {
      // Always restore — even if fn throws
      if (prevToken) {
        await SecureStore.setItemAsync('access_token', prevToken);
      } else {
        await SecureStore.deleteItemAsync('access_token');
      }
    }
  },

  // -------------------------------------------------------------------------
  // fetchDeliveryList — loads today's delivery addresses.
  // Only works if the rider is today's assigned rider.
  // -------------------------------------------------------------------------
  fetchDeliveryList: async () => {
    set({ loadingList: true, listError: null });
    try {
      const result = await get().withRiderToken(() => trackingApi.getDeliveryList());
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
      const result = await get().withRiderToken(() => trackingApi.getMyStops());
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
      await get().withRiderToken(() => trackingApi.markStopDelivered(stopId));
      // Refetch to pick up the new sort_order + polyline.
      await get().fetchMyStops();
    } catch (err) {
      // Roll back and surface the error.
      set({ myStops: prevStops });
      throw err;
    }
  },

  // -------------------------------------------------------------------------
  // startDelivery — requests location permission, then starts a repeating
  // interval that pushes the rider's GPS to the backend every 5 seconds.
  // On start, also asks the backend to recompute the optimized route
  // using the rider's live GPS as origin.
  // -------------------------------------------------------------------------
  startDelivery: async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Location permission denied. Please enable it in Settings.');
    }

    const rider = get().rider;
    if (!rider) throw new Error('Not logged in as rider');

    // Mark as delivering immediately so the UI updates without waiting for
    // the first push interval.
    set({ isDelivering: true });

    // Push location right away, then on the interval.
    const pushOnce = async () => {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const { latitude, longitude } = location.coords;

        // Reverse geocode on device — no server-side geocoding needed.
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        const address = place
          ? [place.name, place.street, place.district, place.city]
              .filter(Boolean)
              .join(', ')
          : null;

        await get().withRiderToken(() =>
          trackingApi.pushLocation(rider.id, {
            latitude,
            longitude,
            current_address: address,
            status: 'delivering',
          })
        );
      } catch (err) {
        // Silent — don't crash the interval on a single failed push.
        console.warn('Location push failed:', err.message);
      }
    };

    await pushOnce();

    // Now that we've pushed our live GPS, ask the backend to recompute
    // the optimized visit order using that GPS as origin — otherwise
    // the initial order was based on stale coords from assignment time.
    // Then refetch stops so the UI picks up the new sort + polyline.
    try {
      await get().withRiderToken(() => trackingApi.recomputeMyRoute());
      await get().fetchMyStops();
    } catch (recomputeErr) {
      // Non-fatal — the rider can still deliver in whatever order
      // was already computed at assignment time. Directions failure
      // shouldn't block them from starting the run.
      console.warn('Route recompute at start failed:', recomputeErr?.message);
    }

    const interval = setInterval(pushOnce, PUSH_INTERVAL_MS);
    set({ _pushInterval: interval });
  },

  // -------------------------------------------------------------------------
  // stopDelivery — clears the GPS interval and marks status as 'done'.
  // Backend requires lat/lng on every push-location call, so we grab the
  // current position one last time before sending the done status.
  // -------------------------------------------------------------------------
  stopDelivery: async () => {
    const { _pushInterval, rider } = get();

    // Stop the interval first so no more pushes fire.
    if (_pushInterval) {
      clearInterval(_pushInterval);
      set({ _pushInterval: null });
    }

    set({ isDelivering: false });

    // Tell the backend delivery is done — include last known coords since
    // the backend requires latitude + longitude on every push-location call.
    if (rider) {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        await get().withRiderToken(() =>
          trackingApi.pushLocation(rider.id, {
            latitude:  location.coords.latitude,
            longitude: location.coords.longitude,
            status:    'done',
          })
        );
      } catch (err) {
        console.warn('Stop delivery push failed:', err.message);
      }
    }
  },

  // -------------------------------------------------------------------------
  // logout — clears all rider state and SecureStore keys.
  // Does NOT touch the user's 'access_token' — they stay logged in.
  // -------------------------------------------------------------------------
  logout: async () => {
    const { _pushInterval } = get();
    if (_pushInterval) clearInterval(_pushInterval);

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
      _pushInterval:   null,
    });
  },
}));
