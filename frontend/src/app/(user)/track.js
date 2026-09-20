import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trackingApi } from '../../api/tracking';
import {
  Card, Chip, EmptyState, ErrorState, GuestGate, Header, LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';
import { useAuthStore } from '../../store/useAuthStore';
import {
  connect as connectSocket,
  getSocket,
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
// -----------------------------------------------------------------------------

// Lazy-load react-native-maps so Expo Go doesn't crash on import.
let MapView = null, Marker = null, Polyline = null, PROVIDER_GOOGLE = null;
try {
  const maps = require('react-native-maps');
  MapView         = maps.default;
  Marker          = maps.Marker;
  Polyline        = maps.Polyline;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
} catch (_) { /* not installed in Expo Go */ }

const MAPS_AVAILABLE = MapView != null;

const DEFAULT_REGION = {
  latitude:      12.9082,
  longitude:     77.5484,
  latitudeDelta:  0.02,
  longitudeDelta: 0.02,
};

const STATUS = {
  idle:       { label: 'Rider is idle',       tone: 'neutral' },
  delivering: { label: 'On the way',          tone: 'teal'    },
  done:       { label: 'Delivery complete',   tone: 'success' },
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
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [etaMinutes, setEta]        = useState(null);
  const [etaAt,      setEtaAt]      = useState(null);   // Date of last update

  // --- Load initial snapshot + user's home pin --------------------------
  const loadSnapshot = useCallback(async () => {
    setLoading(true);
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

      // One-shot ETA request gives us the destination coords too
      // (backend geocodes the user's address). If it 4xx's — e.g. no
      // address set — the map still renders the rider, just no
      // "arriving in X min" line.
      try {
        const etaRes = await trackingApi.getEta();
        if (etaRes.success) {
          if (etaRes.data?.eta?.duration_seconds != null) {
            setEta(Math.round(etaRes.data.eta.duration_seconds / 60));
            setEtaAt(new Date());
          }
          // Drop the "your home" marker + polyline once we know where the
          // destination is. The backend returns it as a plain lat/lng pair.
          const dest = etaRes.data?.destination;
          if (dest?.latitude != null && dest?.longitude != null) {
            setUserPin({
              latitude:  Number(dest.latitude),
              longitude: Number(dest.longitude),
            });
          }
        }
      } catch (_) { /* non-fatal */ }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load the rider's location.");
    } finally {
      setLoading(false);
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
          mapRef.current.animateToRegion(
            {
              latitude:      Number(payload.latitude),
              longitude:     Number(payload.longitude),
              latitudeDelta:  0.02,
              longitudeDelta: 0.02,
            },
            600
          );
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
  const statusCfg = STATUS[rider?.status] || STATUS.idle;

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

      {/* Map — Google provider on Android, Apple Maps on iOS. */}
      {MAPS_AVAILABLE ? (
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={
              hasRiderLocation
                ? {
                    latitude:      Number(rider.latitude),
                    longitude:     Number(rider.longitude),
                    latitudeDelta:  0.02,
                    longitudeDelta: 0.02,
                  }
                : DEFAULT_REGION
            }
            showsUserLocation
            showsMyLocationButton={false}
            // Don't skin the tiles — clean Google map, custom markers only.
          >
            {hasRiderLocation && (
              <Marker
                coordinate={{
                  latitude:  Number(rider.latitude),
                  longitude: Number(rider.longitude),
                }}
                title={rider.name}
                description={rider.current_address || ''}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.riderMarker}>
                  <Ionicons name="bicycle" size={20} color={colors.paper} />
                </View>
              </Marker>
            )}
            {userPin && (
              <Marker
                coordinate={userPin}
                title="Your home"
                anchor={{ x: 0.5, y: 1 }}
              >
                <View style={styles.homeMarker}>
                  <Ionicons name="home" size={16} color={colors.gold} />
                </View>
              </Marker>
            )}
            {hasRiderLocation && userPin && Polyline && (
              // Simple straight polyline — a real route from Directions
              // API is a future upgrade; for now this shows "who's where".
              <Polyline
                coordinates={[
                  { latitude: Number(rider.latitude), longitude: Number(rider.longitude) },
                  userPin,
                ]}
                strokeColor={colors.teal}
                strokeWidth={3}
              />
            )}
          </MapView>

          {/* Recenter button — small overlay, top-right */}
          <Pressable
            onPress={() => {
              if (!hasRiderLocation || !mapRef.current) return;
              mapRef.current.animateToRegion(
                {
                  latitude:      Number(rider.latitude),
                  longitude:     Number(rider.longitude),
                  latitudeDelta:  0.02,
                  longitudeDelta: 0.02,
                },
                500
              );
            }}
            style={({ pressed }) => [styles.recenterBtn, pressed && styles.recenterBtnPressed]}
            accessibilityLabel="Recenter map on rider"
            accessibilityRole="button"
          >
            <Ionicons name="locate" size={20} color={colors.tealDark} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.mapFallback}>
          <Ionicons name="map-outline" size={40} color={colors.inkGhost} />
          <Text style={styles.fallbackTitle}>Map unavailable in Expo Go</Text>
          <Text style={styles.fallbackHint}>Use a development build to see the live map.</Text>
          {hasRiderLocation && (
            <View style={styles.coordsBox}>
              <Text style={styles.coordsText}>
                {Number(rider.latitude).toFixed(5)}, {Number(rider.longitude).toFixed(5)}
              </Text>
            </View>
          )}
        </View>
      )}

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

        {/* ETA hero — the reason this screen exists */}
        {etaMinutes != null ? (
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
