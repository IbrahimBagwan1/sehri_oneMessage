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
import { trackingApi } from '../../api/tracking';
import {
  Card, Chip, EmptyState, ErrorState, GuestGate, Header, LoadingState,
} from '../../components/ui';
import LeafletMap from '../../components/LeafletMap';
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
//   2. Socket events on the `zone:{id}` room:
//        rider_position { latitude, longitude, status, ... }
//        eta_update    { eta_minutes, rider: {...}, ... }
//      These replace the old 8-second polling. The map marker moves as
//      the rider actually moves; the "arriving in X min" readout
//      updates whenever the backend recomputes.
//
// Guest wrapper — see comment in wrapper. Rules-of-hooks stay clean.
//
// Map rendering — LeafletMap (WebView + OpenStreetMap), not
// react-native-maps. See LeafletMap.js for why: RN Maps 1.x on Android
// requires a working Google Cloud Maps SDK setup or the map is a black
// rectangle. Leaflet + OSM works everywhere without a key.
// -----------------------------------------------------------------------------

const DEFAULT_CENTER = { latitude: 12.9082, longitude: 77.5484 };

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
  const [userPin,    setUserPin]    = useState(null); // { latitude, longitude } for the polyline destination
  const [route,      setRoute]      = useState(null); // [{ latitude, longitude }, ...] real driving path from Google Directions
  const [loading,    setLoading]    = useState(true); // ONLY true for the very first load
  const [error,      setError]      = useState(null);
  const [etaMinutes, setEta]        = useState(null);
  const [etaAt,      setEtaAt]      = useState(null);   // Date of last update

  // First-load flag so returning to this tab doesn't dismount the map.
  // Historical bug: useFocusEffect always called loadSnapshot which set
  // loading=true on every re-focus. That unmounted <LeafletMap>, and on
  // Android react-native-webview's teardown+remount is racy — the second
  // WebView instance intermittently loaded blank, needing multiple manual
  // refreshes to recover. Now the first load shows LoadingState; every
  // subsequent focus refetches in the background, keeping the map alive.
  const hasLoadedOnceRef = useRef(false);

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
      }

      // One-shot ETA request gives us the destination coords AND the
      // real road-following polyline (Google Directions). If it 4xx's —
      // e.g. no address set — the map still renders the rider, just no
      // "arriving in X min" line and no route line.
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
          // Real driving route from Directions. Falls back to null if
          // the backend couldn't fetch one — the map effect below will
          // then draw a straight-line polyline between rider ↔ home so
          // the user still sees the two points connected.
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
      } catch (_) { /* non-fatal */ }
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
        // Recenter map on the new rider position.
        if (mapRef.current && payload.latitude != null && payload.longitude != null) {
          mapRef.current.animateTo({
            latitude:  Number(payload.latitude),
            longitude: Number(payload.longitude),
          });
        }
      });

      s.on('eta_update', (payload) => {
        if (!mounted) return;
        if (payload?.eta_minutes != null) {
          setEta(payload.eta_minutes);
          setEtaAt(new Date(payload.at || Date.now()));
        }
      });
    })();

    return () => {
      mounted = false;
      if (currentSocket) {
        currentSocket.off('rider_position');
        currentSocket.off('eta_update');
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

  // Build the marker set for LeafletMap. Kept in a memo so the WebView
  // isn't hammered with re-injects unless the actual coords change.
  const mapMarkers = useMemo(() => {
    const list = [];
    if (hasRiderLocation) {
      list.push({
        id: 'rider',
        latitude:  Number(rider.latitude),
        longitude: Number(rider.longitude),
        kind:      'rider',
        label:     hasArrived ? '🏁' : '🚴',
        title:     rider.name || 'Rider',
      });
    }
    if (userPin) {
      list.push({
        id: 'home',
        latitude:  userPin.latitude,
        longitude: userPin.longitude,
        kind:      'home',
        title:     'Your home',
      });
    }
    return list;
  }, [hasRiderLocation, rider?.latitude, rider?.longitude, rider?.name, userPin, hasArrived]);

  // Polyline to draw on the map:
  //   • real road-following route from Google Directions when we have one
  //   • else a straight rider↔home line as a degrade so the two points
  //     stay visually connected
  //   • null when we don't have both endpoints (map falls back to just
  //     the two markers)
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

  if (!rider || rider.status === 'done') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <TrackHeader />
        <EmptyState
          icon="bicycle-outline"
          title={rider?.status === 'done' ? 'Delivery complete for today' : 'No active delivery'}
          message={
            rider?.status === 'done'
              ? 'The rider has finished today\'s run.'
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

      {/* Map — Leaflet + OSM inside a WebView. See LeafletMap.js. */}
      <View style={styles.mapContainer}>
        <LeafletMap
          ref={mapRef}
          center={
            hasRiderLocation
              ? { latitude: Number(rider.latitude), longitude: Number(rider.longitude) }
              : DEFAULT_CENTER
          }
          zoom={15}
          markers={mapMarkers}
          polyline={mapPolyline}
        />

        {/* Recenter button — small overlay, top-right */}
        <Pressable
          onPress={() => {
            if (!hasRiderLocation || !mapRef.current) return;
            mapRef.current.animateTo({
              latitude:  Number(rider.latitude),
              longitude: Number(rider.longitude),
            });
          }}
          style={({ pressed }) => [styles.recenterBtn, pressed && styles.recenterBtnPressed]}
          accessibilityLabel="Recenter map on rider"
          accessibilityRole="button"
        >
          <Ionicons name="locate" size={20} color={colors.tealDark} />
        </Pressable>
      </View>

      {/* -------- Bottom info panel — status + ETA + rider identity -------- */}
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Chip
            label={statusCfg.label}
            tone={statusCfg.tone}
            icon={rider?.status === 'delivering' ? 'radio-outline' : 'time-outline'}
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
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.teal,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.paper,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4 },
      android: { elevation: 6 },
    }),
  },
  // User home marker — parchment tile with a home glyph.
  homeMarker: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: colors.goldSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.goldBorder,
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
  recenterBtnPressed: { backgroundColor: colors.tealSoft },

  mapFallback: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: space[8], gap: space[2],
  },
  fallbackTitle: { ...type.bodyStrong, color: colors.inkMuted },
  fallbackHint:  { ...type.meta, textAlign: 'center' },
  coordsBox: {
    marginTop: space[3],
    backgroundColor: colors.ruleFaint,
    paddingHorizontal: space[3], paddingVertical: space[2],
    borderRadius: radius.md,
  },
  coordsText: { ...type.meta, color: colors.inkMuted, fontVariant: ['tabular-nums'] },

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
