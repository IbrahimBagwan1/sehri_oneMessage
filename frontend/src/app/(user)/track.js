import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';
import { trackingApi } from '../../api/tracking';
import {
  Card, Chip, EmptyState, ErrorState, GuestGate, Header, LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';
import { useAuthStore } from '../../store/useAuthStore';
import {
  connect as connectSocket,
  subscribeTracking,
  unsubscribeTracking,
} from '../../services/socket';

// -----------------------------------------------------------------------------
// TrackScreen — live delivery map for signed-in users.
//
// Data model: two sources of truth
//   1. GET /api/tracking/active — snapshot at mount so the map has an
//      initial rider position even before the first socket event lands.
//      GET /api/tracking/eta    — snapshot for the destination pin + the
//      real driving polyline (Google Directions) computed against the
//      SHARED destination (their PG's fixed lat/lng, not a per-user
//      geocode of their address text). See resolveDeliveryDestination
//      in backend/src/controllers/trackingController.js.
//   2. Socket events on the `zone:{id}` room:
//        rider_position { latitude, longitude, status, ... }
//        eta_update    { eta_minutes, route, rider: {...}, ... }
//      These replace the old 8-second polling. The map marker moves as
//      the rider actually moves; the "arriving in X min" readout
//      updates whenever the backend recomputes; and the polyline
//      redraws with the fresh driving path — shared per-destination so
//      every user at the same PG sees the identical route (the backend
//      dedupes by destination coord and computes Directions once per PG).
//
// Guest wrapper — see comment in wrapper. Rules-of-hooks stay clean.
//
// Map rendering — native Google Maps via react-native-maps
// (PROVIDER_GOOGLE). The Android key lives in app.json under
// android.config.googleMaps.apiKey and is injected by the
// react-native-maps config plugin during `npx expo prebuild`. iOS uses
// ios.config.googleMapsApiKey via the same plugin. This requires a dev
// client build — Expo Go doesn't ship the Google Maps native SDK.
// -----------------------------------------------------------------------------

// Bangalore-centered fallback used only until the first rider position
// or destination arrives.
const DEFAULT_REGION = {
  latitude:  12.9082,
  longitude: 77.5484,
  latitudeDelta:  0.06,
  longitudeDelta: 0.06,
};

const STATUS = {
  idle:       { label: 'Rider is idle',       tone: 'neutral' },
  delivering: { label: 'On the way',          tone: 'teal'    },
  done:       { label: 'Delivery complete',   tone: 'success' },
};

// Client-side proximity threshold — once the rider is within this many
// meters of the user's home pin we switch from "arriving in X min" to
// an arrived banner. Backend also fires a proximity push at 5 min ETA,
// but that's a coarser signal; this is the visible-on-screen final beat.
const ARRIVAL_THRESHOLD_M = 80;

// Haversine great-circle distance in meters between two {latitude, longitude}
// pairs. Sub-meter accurate at the scales we care about (< a few km).
const distanceMeters = (a, b) => {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Camera-fit helper: given the current markers, compute a region that
// keeps both the rider and the home marker on screen with breathing
// room. Called on initial load and after big jumps — the interstitial
// smooth-follow uses animateCamera on the rider position alone.
const regionForMarkers = (rider, home) => {
  if (rider && home) {
    const latMin = Math.min(rider.latitude, home.latitude);
    const latMax = Math.max(rider.latitude, home.latitude);
    const lngMin = Math.min(rider.longitude, home.longitude);
    const lngMax = Math.max(rider.longitude, home.longitude);
    const pad = 0.008; // ~800 m breathing room around the bounds
    return {
      latitude:  (latMin + latMax) / 2,
      longitude: (lngMin + lngMax) / 2,
      latitudeDelta:  Math.max(0.008, (latMax - latMin) + pad),
      longitudeDelta: Math.max(0.008, (lngMax - lngMin) + pad),
    };
  }
  if (rider) {
    return { ...DEFAULT_REGION, latitude: rider.latitude, longitude: rider.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 };
  }
  if (home) {
    return { ...DEFAULT_REGION, latitude: home.latitude, longitude: home.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 };
  }
  return DEFAULT_REGION;
};

export default function TrackScreen() {
  const isGuest = useAuthStore((s) => s.isGuest);
  if (isGuest) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Live tracking" />
        <GuestGate
          icon="location-outline"
          title="Live tracking is for members"
          message="Sign in to see today's rider on the map with live ETA to your address."
        />
      </SafeAreaView>
    );
  }
  return <TrackScreenAuthed />;
}

function TrackScreenAuthed() {
  const mapRef = useRef(null);

  // Initial snapshot from REST (so the map isn't empty for the first
  // second before the socket kicks in).
  const [rider,      setRider]      = useState(null);
  const [userPin,    setUserPin]    = useState(null); // shared PG coord — { latitude, longitude }
  const [route,      setRoute]      = useState(null); // [{latitude,longitude}, ...] — shared per destination
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  // Backend attaches the user's delivery_stop (if any) to /tracking/active.
  // The stop status drives the "delivered" branch — socket-pushed
  // stop_delivered events flip it in real time.
  const [stopStatus, setStopStatus] = useState(null); // 'pending' | 'delivered' | null
  const [etaMinutes, setEta]        = useState(null);
  const [etaAt,      setEtaAt]      = useState(null); // Date of last update
  const [autoFollow, setAutoFollow] = useState(true); // pauses when user pans the map

  // First-load flag so returning to this tab doesn't dismount the map.
  // Only the very first snapshot fires the full <LoadingState/> branch;
  // every re-focus reloads in the background with the map still alive.
  const hasLoadedOnceRef = useRef(false);
  // Track when we last recentered on the rider — throttles smooth-follow
  // to at most once every 1500 ms so a rapid GPS burst doesn't churn the
  // camera. Matches the "throttle sensibly" pattern the backend ETA
  // service already uses (RECOMPUTE_MIN_SECONDS = 30 s over there;
  // the camera can afford to be more responsive but not on every ping).
  const lastFollowRef = useRef(0);

  // --- Load initial snapshot + user's home pin --------------------------
  const loadSnapshot = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setLoading(true);
    setError(null);
    try {
      // Rider snapshot. Backend also returns null when rider isn't
      // active for this zone — treated as an empty state, not an error.
      const res = await trackingApi.getActiveRider();
      if (res.success) {
        const r = res.data.rider;
        setRider(r);
        if (r?.eta_minutes != null) setEta(r.eta_minutes);
        // The delivery_stop for this user's PG comes with the snapshot
        // now (multi-rider resolution) — surface its status so the
        // "delivered" branch renders correctly on cold load.
        setStopStatus(res.data?.stop?.status ?? null);
      }

      // One-shot ETA request gives us the SHARED destination coords
      // (resolved from the user's Location pin, NOT geocoded from their
      // address text — see backend resolveDeliveryDestination) AND the
      // shared road-following polyline from Google Directions.
      try {
        const etaRes = await trackingApi.getEta();
        if (etaRes.success) {
          if (etaRes.data?.eta?.duration_seconds != null) {
            setEta(Math.round(etaRes.data.eta.duration_seconds / 60));
            setEtaAt(new Date());
          }
          const dest = etaRes.data?.destination;
          if (dest?.latitude != null && dest?.longitude != null) {
            setUserPin({
              latitude:  Number(dest.latitude),
              longitude: Number(dest.longitude),
            });
          }
          const path = etaRes.data?.route;
          if (Array.isArray(path) && path.length >= 2) {
            setRoute(path.map((p) => ({
              latitude:  Number(p.latitude),
              longitude: Number(p.longitude),
            })));
          } else {
            setRoute(null);
          }
        }
      } catch (_) { /* non-fatal — map still renders rider without ETA */ }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load the rider's location.");
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
    }
  }, []);

  // --- Socket subscription — live rider position + per-user ETA --------
  useEffect(() => {
    let mounted = true;
    let currentSocket = null;

    (async () => {
      const s = await connectSocket();
      if (!mounted || !s) return;
      currentSocket = s;
      subscribeTracking(); // backend uses the JWT's zone if none passed

      s.on('rider_position', (payload) => {
        if (!mounted) return;
        // `done` events mean the rider wrapped up — hide the marker.
        if (payload?.status === 'done') {
          setRider((prev) => (prev ? { ...prev, status: 'done' } : prev));
          return;
        }
        setRider((prev) => ({
          ...(prev || {}),
          id: payload.rider_id || prev?.id,
          name: payload.name || prev?.name,
          latitude:  payload.latitude,
          longitude: payload.longitude,
          status:    payload.status || 'delivering',
          eta_minutes: payload.eta_minutes ?? prev?.eta_minutes,
        }));
      });

      s.on('eta_update', (payload) => {
        if (!mounted) return;
        if (payload?.eta_minutes != null) {
          setEta(payload.eta_minutes);
          setEtaAt(new Date(payload.at || Date.now()));
        }
        // Shared polyline for this destination — every user at the same
        // PG receives an eta_update with the identical `route` array
        // because the backend dedupes by destination coord and calls
        // Directions once per PG.
        if (Array.isArray(payload?.route) && payload.route.length >= 2) {
          setRoute(payload.route.map((p) => ({
            latitude:  Number(p.latitude),
            longitude: Number(p.longitude),
          })));
        }
      });

      // Rider marked our stop delivered → flip into the "delivered"
      // state instantly. The empty-state branch below handles the
      // final render (message + rider attribution).
      s.on('stop_delivered', (payload) => {
        if (!mounted) return;
        setStopStatus('delivered');
        // Mirror on rider so the empty state uses the "delivery complete"
        // copy — matches the existing done-status pattern.
        setRider((prev) => (prev ? { ...prev, status: 'done' } : prev));
      });
    })();

    return () => {
      mounted = false;
      if (currentSocket) {
        currentSocket.off('rider_position');
        currentSocket.off('eta_update');
        currentSocket.off('stop_delivered');
      }
      unsubscribeTracking();
    };
  }, []);

  useFocusEffect(useCallback(() => { loadSnapshot(); }, [loadSnapshot]));

  const hasRiderLocation = rider?.latitude != null && rider?.longitude != null;

  // Client-side arrival detection. The kitchen's push-based proximity
  // ping fires at 5 min ETA (backend), but that leaves a gap — nobody
  // tells the user "he's here" when the rider actually pulls up. This
  // computes the great-circle distance between the current rider
  // position and the user's home pin on every render and switches into
  // an arrival state when we're within ARRIVAL_THRESHOLD_M and the
  // rider is still marked as delivering. Once the backend flips status
  // to 'done' the empty/done branch below takes over.
  const distanceToHome = useMemo(() => {
    if (!hasRiderLocation || !userPin) return null;
    return distanceMeters(
      { latitude: Number(rider.latitude), longitude: Number(rider.longitude) },
      userPin,
    );
  }, [hasRiderLocation, rider?.latitude, rider?.longitude, userPin]);

  const hasArrived =
    hasRiderLocation &&
    userPin &&
    rider?.status === 'delivering' &&
    distanceToHome != null &&
    distanceToHome <= ARRIVAL_THRESHOLD_M;

  const statusCfg = hasArrived
    ? { label: 'Arrived at your address', tone: 'success' }
    : (STATUS[rider?.status] || STATUS.idle);

  // Polyline to draw: prefer the real Directions route; fall back to a
  // straight rider↔home line so the two points stay visually connected
  // even if Directions failed or hasn't returned yet.
  const mapPolyline = useMemo(() => {
    if (route && route.length >= 2) return route;
    if (hasRiderLocation && userPin) {
      return [
        { latitude: Number(rider.latitude), longitude: Number(rider.longitude) },
        userPin,
      ];
    }
    return null;
  }, [route, hasRiderLocation, rider?.latitude, rider?.longitude, userPin]);

  // Initial region — set once on mount from whatever we have. Post-mount
  // we drive camera changes imperatively via mapRef so the state ping
  // rate stays independent from the region prop.
  const initialRegion = useMemo(() => {
    return regionForMarkers(
      hasRiderLocation ? { latitude: Number(rider.latitude), longitude: Number(rider.longitude) } : null,
      userPin,
    );
    // We want this computed ONCE, on first render — subsequent updates
    // are handled by the auto-follow effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smooth follow: keep the rider centered as they move, but ONLY when
  // the user hasn't panned away (autoFollow=true) and throttled so a
  // rapid GPS burst doesn't animate the camera 5 times per second.
  useEffect(() => {
    if (!autoFollow || !mapRef.current || !hasRiderLocation) return;
    const now = Date.now();
    if (now - lastFollowRef.current < 1500) return;
    lastFollowRef.current = now;
    mapRef.current.animateCamera(
      {
        center: {
          latitude:  Number(rider.latitude),
          longitude: Number(rider.longitude),
        },
      },
      { duration: 800 }
    );
  }, [autoFollow, hasRiderLocation, rider?.latitude, rider?.longitude]);

  // -------------------- Render states --------------------
  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <TrackHeader />
        <LoadingState message="Loading rider's location…" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <TrackHeader />
        <ErrorState message={error} onRetry={loadSnapshot} />
      </SafeAreaView>
    );
  }

  // Empty / done branch: no rider, rider's whole run done, OR OUR
  // specific stop was delivered (multi-rider case — rider may still be
  // delivering other PGs but our Sehri is here).
  if (!rider || rider.status === 'done' || stopStatus === 'delivered') {
    const isDelivered = rider?.status === 'done' || stopStatus === 'delivered';
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <TrackHeader />
        <EmptyState
          icon={isDelivered ? 'checkmark-done-circle-outline' : 'bicycle-outline'}
          title={isDelivered ? 'Sehri delivered' : 'No active delivery'}
          message={
            isDelivered
              ? (rider?.name
                  ? `${rider.name} marked your Sehri as delivered. Jazak-Allahu-khayran.`
                  : 'Your Sehri has been delivered.')
              : "The rider hasn't started yet. Check back closer to Sehri time."
          }
          actionLabel="Refresh"
          onAction={loadSnapshot}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <TrackHeader live />

      {/* Map — native Google Maps via react-native-maps */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={initialRegion}
          // User pan disables auto-follow so the map doesn't fight them.
          // Recenter button re-arms it.
          onPanDrag={() => {
            if (autoFollow) setAutoFollow(false);
          }}
          showsCompass={false}
          showsMyLocationButton={false}
          showsPointsOfInterest={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          loadingEnabled
          loadingIndicatorColor={colors.teal}
          loadingBackgroundColor={colors.paperSoft}
        >
          {hasRiderLocation && (
            <Marker
              identifier="rider"
              coordinate={{
                latitude:  Number(rider.latitude),
                longitude: Number(rider.longitude),
              }}
              // anchor at the visual centre of our custom pin
              anchor={{ x: 0.5, y: 0.5 }}
              // Custom themed pin — deep teal disk with a bicycle glyph
              // (or checkered flag once arrived). Bypasses Google's
              // default red pin so the map matches the app's identity.
              // `tracksViewChanges` set to false after mount for perf on
              // Android — a moving marker on Android otherwise redraws
              // the tile layer under it (jank).
              tracksViewChanges={false}
              title={rider.name || 'Rider'}
              description={hasArrived ? 'Arrived at your address' : 'On the way'}
            >
              <View style={hasArrived ? styles.riderMarkerArrived : styles.riderMarker}>
                <Ionicons
                  name={hasArrived ? 'flag' : 'bicycle'}
                  size={18}
                  color={colors.paper}
                />
              </View>
            </Marker>
          )}
          {userPin && (
            <Marker
              identifier="home"
              coordinate={userPin}
              anchor={{ x: 0.5, y: 1 }}
              tracksViewChanges={false}
              title="Your PG"
              description="Delivery destination"
            >
              {/* Gold parchment tag with a home glyph — matches the
                  app's warm-tone chips and cards. */}
              <View style={styles.homeMarkerWrap}>
                <View style={styles.homeMarker}>
                  <Ionicons name="home" size={14} color={colors.gold} />
                </View>
                <View style={styles.homeMarkerTail} />
              </View>
            </Marker>
          )}
          {mapPolyline && mapPolyline.length >= 2 && (
            <Polyline
              coordinates={mapPolyline}
              strokeColor={colors.teal}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
              // Faint dashed style when we're falling back to a straight
              // rider↔home line (no real Directions data yet); solid
              // stroke for the real road route. `route` state is the
              // decoded Directions path.
              lineDashPattern={route && route.length >= 2 ? undefined : [8, 6]}
              geodesic
            />
          )}
        </MapView>

        {/* Recenter button — small overlay, top-right. Re-arms auto-follow. */}
        <Pressable
          onPress={() => {
            if (!hasRiderLocation || !mapRef.current) return;
            setAutoFollow(true);
            lastFollowRef.current = 0;
            mapRef.current.animateCamera(
              {
                center: {
                  latitude:  Number(rider.latitude),
                  longitude: Number(rider.longitude),
                },
              },
              { duration: 500 }
            );
          }}
          style={({ pressed }) => [styles.recenterBtn, pressed && styles.recenterBtnPressed]}
          accessibilityLabel={autoFollow ? 'Auto-follow on' : 'Recenter map on rider'}
          accessibilityRole="button"
        >
          <Ionicons
            name={autoFollow ? 'locate' : 'locate-outline'}
            size={20}
            color={autoFollow ? colors.tealDark : colors.inkMuted}
          />
        </Pressable>

        {/* Fit-both button — one-tap way to zoom back to include both
            markers after zooming in on the rider. */}
        {hasRiderLocation && userPin && (
          <Pressable
            onPress={() => {
              if (!mapRef.current) return;
              setAutoFollow(false);
              mapRef.current.animateToRegion(
                regionForMarkers(
                  { latitude: Number(rider.latitude), longitude: Number(rider.longitude) },
                  userPin,
                ),
                600
              );
            }}
            style={({ pressed }) => [styles.fitBothBtn, pressed && styles.recenterBtnPressed]}
            accessibilityLabel="Fit rider and home on screen"
            accessibilityRole="button"
          >
            <Ionicons name="scan-outline" size={18} color={colors.tealDark} />
          </Pressable>
        )}
      </View>

      {/* -------- Bottom info panel — status + ETA + rider identity -------- */}
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Chip
            label={statusCfg.label}
            tone={statusCfg.tone}
            icon={hasArrived ? 'checkmark-circle-outline' : rider?.status === 'delivering' ? 'radio-outline' : 'time-outline'}
          />
          <View style={styles.livePill}>
            <View style={styles.livePulse} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        </View>

        {/* ETA hero — takes three shapes:
              1. rider is at the door           → arrival banner
              2. rider is en route, ETA known   → "Arriving in X min"
              3. still waiting on first ETA     → "Calculating…" */}
        {hasArrived ? (
          <View style={[styles.etaHero, styles.etaHeroArrived]}>
            <Text style={[styles.etaEyebrow, styles.etaEyebrowArrived]}>
              At your address
            </Text>
            <View style={styles.etaRow}>
              <Ionicons name="checkmark-circle" size={28} color={colors.success} />
              <Text style={[styles.etaWaiting, styles.etaValueArrived]}>
                Rider has arrived
              </Text>
            </View>
            <Text style={styles.etaFreshness}>
              Please step out to collect your Sehri.
            </Text>
          </View>
        ) : etaMinutes != null ? (
          <View style={styles.etaHero}>
            <Text style={styles.etaEyebrow}>Arriving in</Text>
            <View style={styles.etaRow}>
              <Text style={styles.etaValue}>
                {etaMinutes <= 1 ? '~1' : etaMinutes}
              </Text>
              <Text style={styles.etaUnit}>{etaMinutes <= 1 ? 'min' : 'minutes'}</Text>
            </View>
            {etaAt && (
              <Text style={styles.etaFreshness}>
                Updated {formatFreshness(etaAt)}
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.etaHero}>
            <Text style={styles.etaEyebrow}>ETA</Text>
            <Text style={styles.etaWaiting}>Calculating…</Text>
            <Text style={styles.etaFreshness}>
              We&apos;ll update this as soon as the rider starts moving.
            </Text>
          </View>
        )}

        {/* Rider identity row */}
        <View style={styles.riderRow}>
          <View style={styles.riderAvatar}>
            <Ionicons name="person" size={18} color={colors.tealDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.riderName}>{rider.name}</Text>
            {rider.zone?.name ? <Text style={styles.riderZone}>Serving {rider.zone.name}</Text> : null}
          </View>
        </View>

        {rider.current_address ? (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={15} color={colors.inkFaint} />
            <Text style={styles.addressText} numberOfLines={2}>{rider.current_address}</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

// -------- Small components --------

function TrackHeader({ live }) {
  return (
    <Header
      title="Live tracking"
      trailing={live ? (
        <View style={styles.headerLivePill}>
          <View style={styles.livePulse} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      ) : null}
    />
  );
}

// "Updated just now" / "Updated 2 min ago"
function formatFreshness(date) {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 30) return 'just now';
  if (sec < 90) return '1 min ago';
  return `${Math.round(sec / 60)} min ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  headerLivePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: space[2], paddingVertical: 4,
    borderRadius: radius.pill,
  },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: space[2], paddingVertical: 3,
    borderRadius: radius.pill,
  },
  livePulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  liveText:  { ...type.micro, color: colors.danger, fontWeight: '700' },

  mapContainer: { flex: 1 },
  map:          { flex: 1 },

  // Rider marker — teal disk with a bicycle glyph.
  riderMarker: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.teal,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.paper,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4 },
      android: { elevation: 6 },
    }),
  },
  // Same disk, tinted success (green) once the rider has arrived —
  // flag glyph replaces the bicycle.
  riderMarkerArrived: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.success,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.paper,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4 },
      android: { elevation: 6 },
    }),
  },
  // Destination marker — warm parchment tag with a small triangle
  // pointing down to the anchor point (bottom-centre).
  homeMarkerWrap: { alignItems: 'center' },
  homeMarker: {
    width: 32, height: 32, borderRadius: radius.md,
    backgroundColor: colors.goldSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.goldBorder,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 2 },
      android: { elevation: 3 },
    }),
  },
  homeMarkerTail: {
    width: 0, height: 0,
    borderLeftWidth:  6, borderRightWidth:  6, borderTopWidth: 6,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    borderTopColor:   colors.goldBorder,
    marginTop: -1,
  },

  recenterBtn: {
    position: 'absolute',
    top: 16, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.paper,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.ruleSoft,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3 },
      android: { elevation: 4 },
    }),
  },
  fitBothBtn: {
    position: 'absolute',
    top: 68, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.paper,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.ruleSoft,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3 },
      android: { elevation: 4 },
    }),
  },
  recenterBtnPressed: { backgroundColor: colors.tealSoft },

  panel: {
    backgroundColor: colors.paper,
    paddingHorizontal: space[5],
    paddingTop: space[4], paddingBottom: space[3],
    borderTopWidth: 1, borderTopColor: colors.ruleSoft,
    gap: space[3],
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  etaHero: {
    backgroundColor: colors.tealSoft,
    borderColor: colors.tealBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  etaEyebrow: { ...type.micro, color: colors.tealDark, fontWeight: '700', marginBottom: 2 },
  etaEyebrowArrived: { color: colors.success },
  etaHeroArrived: { backgroundColor: colors.successSoft, borderColor: colors.success },
  etaValueArrived: { color: colors.success, marginLeft: space[2] },
  etaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  etaValue: {
    fontSize: 42, fontWeight: '800', color: colors.tealDark,
    letterSpacing: -1, fontVariant: ['tabular-nums'],
  },
  etaUnit:      { ...type.bodyStrong, color: colors.tealDark, marginLeft: 4 },
  etaWaiting:   { fontSize: 26, fontWeight: '800', color: colors.tealDark, letterSpacing: -0.6 },
  etaFreshness: { ...type.micro, color: colors.inkFaint, marginTop: 4 },

  riderRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  riderAvatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.tealSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  riderName: { ...type.h3 },
  riderZone: { ...type.meta, marginTop: 2 },

  addressRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  addressText: { flex: 1, ...type.body, color: colors.inkMuted },
});
