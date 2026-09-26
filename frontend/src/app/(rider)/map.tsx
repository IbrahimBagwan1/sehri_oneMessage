// @ts-nocheck
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';
import { useRiderStore } from '../../store/useRiderStore';
import { Button, Chip, Header, LoadingState } from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Rider map — the rider's own live position PLUS today's optimized
// delivery route:
//   • polyline through every pending stop's coord in visit order
//     (Google Directions, computed backend-side in /my-stops)
//   • numbered teal pins for each pending stop
//   • gray checkmark pins for delivered stops
//
// Start/Stop delivery lives in the bottom panel — Start triggers a
// route recompute using the rider's live GPS as origin so the first
// stop is the closest one to them right now.
//
// Native Google Maps via react-native-maps + PROVIDER_GOOGLE.
// Requires a dev-client build (Expo Go doesn't ship Google Maps).
// -----------------------------------------------------------------------------

const DEFAULT_REGION = {
  latitude:  12.9716,
  longitude: 77.5946,
  latitudeDelta:  0.02,
  longitudeDelta: 0.02,
};

// Compute a region that comfortably fits the rider + all stops.
const regionFor = (rider, stops) => {
  const points = [];
  if (rider) points.push(rider);
  for (const s of stops || []) {
    if (s.has_pin) points.push({ latitude: s.latitude, longitude: s.longitude });
  }
  if (points.length === 0) return DEFAULT_REGION;
  if (points.length === 1) {
    return { ...points[0], latitudeDelta: 0.02, longitudeDelta: 0.02 };
  }
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const pad = 0.01;
  return {
    latitude:  (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta:  Math.max(0.01, Math.max(...lats) - Math.min(...lats) + pad),
    longitudeDelta: Math.max(0.01, Math.max(...lngs) - Math.min(...lngs) + pad),
  };
};

export default function RiderMapScreen() {
  const router          = useRouter();
  const rider           = useRiderStore((s) => s.rider);
  const isDelivering    = useRiderStore((s) => s.isDelivering);
  const startDelivery   = useRiderStore((s) => s.startDelivery);
  const stopDelivery    = useRiderStore((s) => s.stopDelivery);
  const logout          = useRiderStore((s) => s.logout);
  const fetchMyStops    = useRiderStore((s) => s.fetchMyStops);
  const myStops         = useRiderStore((s) => s.myStops);
  const routePolyline   = useRiderStore((s) => s.routePolyline);
  const stopsSummary    = useRiderStore((s) => s.stopsSummary);

  const mapRef      = useRef<any>(null);
  const followRef   = useRef(0);
  const initialFitRef = useRef(false);

  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentAddress,  setCurrentAddress]  = useState<string | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [toggling,        setToggling]        = useState(false);

  // Refetch stops whenever the map tab is focused. Cheap round-trip
  // and keeps the route fresh if delivered-by-another-rider events
  // came in while we were away.
  useFocusEffect(useCallback(() => { fetchMyStops(); }, [fetchMyStops]));

  // Keep the camera-follow behaviour reading the CURRENT delivering flag
  // without making the watch itself depend on it. Previously `isDelivering`
  // was an effect dependency, so every Start/Stop tore the whole thing down
  // and rebuilt it: a fresh permission prompt, a fresh high-accuracy fix, a
  // fresh reverse-geocode, and a brand new subscription.
  const deliveringRef = useRef(isDelivering);
  useEffect(() => { deliveringRef.current = isDelivering; });

  // The rider's own blue dot.
  //
  // This is SEPARATE from the background task that reports position to the
  // server (services/riderLocationTask.js, every 30s). This one exists only
  // to move the marker on a map the rider is actually looking at, so it is
  // bound to focus: when they switch to the Deliveries tab or leave the app,
  // it stops entirely and the background task carries on reporting alone.
  useFocusEffect(
    useCallback(() => {
      let subscription: any = null;
      let cancelled = false;

      (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setLoadingLocation(false);
          setPermissionDenied(true);
          return;
        }
        setPermissionDenied(false);

        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          if (cancelled) return;
          setCurrentLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });

          try {
            const [place] = await Location.reverseGeocodeAsync({
              latitude: loc.coords.latitude, longitude: loc.coords.longitude,
            });
            if (!cancelled && place) {
              setCurrentAddress([place.name, place.street, place.district, place.city].filter(Boolean).join(', '));
            }
          } catch { /* best-effort label */ }
        } catch { /* no fix yet — the watch below will deliver one */ }

        if (cancelled) return;
        setLoadingLocation(false);

        const sub = await Location.watchPositionAsync(
          // 5s / 10m rather than 4s / 5m. The marker still reads as live to
          // someone watching it, and this is on top of the 30s reporting
          // task — there is no reason for both to run hot.
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
          (newLoc) => {
            const coords = { latitude: newLoc.coords.latitude, longitude: newLoc.coords.longitude };
            setCurrentLocation(coords);
            // Throttle camera-follow to at most once every ~1.5s.
            const now = Date.now();
            if (mapRef.current && now - followRef.current > 1500 && deliveringRef.current) {
              followRef.current = now;
              mapRef.current.animateCamera({ center: coords }, { duration: 700 });
            }
          }
        );

        // The screen may have blurred while we were awaiting. Without this
        // the subscription is created after cleanup has already run and is
        // never removed — a leaked GPS watch, one per Start/Stop tap.
        if (cancelled) { sub.remove(); return; }
        subscription = sub;
      })();

      return () => {
        cancelled = true;
        subscription?.remove();
      };
    }, [])
  );

  // First-time fit: once we know both rider location AND have stops,
  // zoom out to include everything so the rider sees their full route
  // at a glance. Ref-guarded so we don't fight the user's panning later.
  useEffect(() => {
    if (initialFitRef.current) return;
    if (!currentLocation || !myStops || myStops.length === 0 || !mapRef.current) return;
    initialFitRef.current = true;
    setTimeout(() => {
      mapRef.current?.animateToRegion(regionFor(currentLocation, myStops), 600);
    }, 350);
  }, [currentLocation, myStops]);

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (isDelivering) await stopDelivery();
      else              await startDelivery(); // also recomputes + refetches stops
    } catch (err: any) {
      Alert.alert('Something went wrong', err?.message || 'Try again in a moment.');
    } finally {
      setToggling(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign out?', "You'll need to sign back in to record deliveries.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } },
    ]);
  };

  // Computed inline rather than memoised, deliberately.
  //
  // MapView reads `initialRegion` ONCE at mount and ignores it after, so
  // there's nothing to memoise against — and the map only mounts once
  // loadingLocation is false, by which point currentLocation is already
  // set. Stops that arrive later are handled by the fit-to-route effect
  // above, and the camera is driven imperatively from then on.
  //
  // (The previous version memoised on `[currentLocation != null, ...]` —
  // a boolean that latches true, so the memo never recomputed. It worked
  // by accident and hid the intent.)
  const initialRegion = regionFor(currentLocation, myStops);

  const pendingStops = useMemo(
    () => (myStops || []).filter((s) => s.status === 'pending' && s.has_pin),
    [myStops]
  );
  const deliveredStops = useMemo(
    () => (myStops || []).filter((s) => s.status === 'delivered' && s.has_pin),
    [myStops]
  );

  // Number = position in the pending queue (1-indexed). Delivered
  // markers don't get a number — a checkmark badge stands in.
  const numberForPendingStop = (id) => {
    const sorted = [...pendingStops].sort((a, b) => {
      const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });
    return sorted.findIndex((s) => s.id === id) + 1;
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Rider map"
        subtitle={rider?.name}
        trailing={
          <Ionicons.Button
            name="log-out-outline"
            size={22}
            color={colors.danger}
            backgroundColor="transparent"
            onPress={handleLogout}
            style={{ padding: 0, margin: 0 }}
            underlayColor="transparent"
            iconStyle={{ marginRight: 0 }}
          />
        }
      />

      <View style={styles.mapContainer}>
        {loadingLocation ? (
          <View style={styles.mapPlaceholder}>
            <LoadingState message="Getting your location…" />
          </View>
        ) : permissionDenied ? (
          <View style={styles.mapPlaceholder}>
            <Ionicons name="location-outline" size={40} color={colors.warn} />
            <Text style={styles.placeholderTitle}>Location permission is off</Text>
            <Text style={styles.placeholderHint}>
              Enable location for OneMessage in Settings so we can broadcast
              your position to the community while you deliver.
            </Text>
          </View>
        ) : (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={initialRegion}
            showsUserLocation
            followsUserLocation={false}
            showsMyLocationButton={false}
            showsCompass={false}
            showsPointsOfInterest={false}
            toolbarEnabled={false}
            loadingEnabled
            loadingIndicatorColor={colors.teal}
            loadingBackgroundColor={colors.paperSoft}
          >
            {/* Rider's own pin */}
            {currentLocation && (
              <Marker
                identifier="self"
                coordinate={currentLocation}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                title={rider?.name || 'You'}
                description={isDelivering ? 'Broadcasting live' : 'Idle'}
              >
                <View style={isDelivering ? styles.selfMarkerLive : styles.selfMarker}>
                  <Ionicons
                    name={isDelivering ? 'radio' : 'ellipse'}
                    size={16}
                    color={colors.paper}
                  />
                </View>
              </Marker>
            )}

            {/* Delivered stops — subtle checkmark pins so context stays
                on the map (rider can see progress) without visual noise. */}
            {deliveredStops.map((s) => (
              <Marker
                key={`done-${s.id}`}
                identifier={`done-${s.id}`}
                coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                anchor={{ x: 0.5, y: 1 }}
                tracksViewChanges={false}
                title={s.location_name}
                description="Delivered"
              >
                <View style={styles.doneStopWrap}>
                  <View style={styles.doneStopPin}>
                    <Ionicons name="checkmark" size={13} color={colors.paper} />
                  </View>
                  <View style={styles.doneStopTail} />
                </View>
              </Marker>
            ))}

            {/* Pending stops — numbered teal pins in visit order. */}
            {pendingStops.map((s) => {
              const n = numberForPendingStop(s.id);
              const isNext = n === 1;
              return (
                <Marker
                  key={`stop-${s.id}`}
                  identifier={`stop-${s.id}`}
                  coordinate={{ latitude: s.latitude, longitude: s.longitude }}
                  anchor={{ x: 0.5, y: 1 }}
                  tracksViewChanges={false}
                  title={`Stop ${n} · ${s.location_name}`}
                  description={`${s.packet_count} packet${s.packet_count === 1 ? '' : 's'}`}
                >
                  <View style={styles.stopMarkerWrap}>
                    <View style={[styles.stopPin, isNext && styles.stopPinNext]}>
                      <Text style={[styles.stopPinNum, isNext && styles.stopPinNumNext]}>{n}</Text>
                    </View>
                    <View style={[styles.stopPinTail, isNext && styles.stopPinTailNext]} />
                  </View>
                </Marker>
              );
            })}

            {/* Route polyline — the actual road path through pending stops. */}
            {Array.isArray(routePolyline) && routePolyline.length >= 2 && (
              <Polyline
                coordinates={routePolyline}
                strokeColor={colors.teal}
                strokeWidth={4}
                lineCap="round"
                lineJoin="round"
                geodesic
              />
            )}
          </MapView>
        )}

        {/* Route summary pill top-left when we have stops */}
        {myStops && myStops.length > 0 && (
          <View style={styles.routePill}>
            <Ionicons name="map-outline" size={14} color={colors.tealDark} />
            <Text style={styles.routePillText}>
              {stopsSummary?.pending_stops ?? pendingStops.length} of {stopsSummary?.total_stops ?? myStops.length} stops left
            </Text>
          </View>
        )}

        {/* Fit-to-route button — one-tap zoom back to full route */}
        {myStops && myStops.length > 0 && currentLocation && (
          <Pressable
            onPress={() => {
              if (!mapRef.current) return;
              mapRef.current.animateToRegion(regionFor(currentLocation, myStops), 500);
            }}
            style={({ pressed }) => [styles.fitBtn, pressed && styles.btnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Fit whole route on screen"
          >
            <Ionicons name="scan-outline" size={18} color={colors.tealDark} />
          </Pressable>
        )}
      </View>

      {/* Bottom panel */}
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Chip
            label={isDelivering ? 'Broadcasting location' : 'Idle'}
            tone={isDelivering ? 'teal' : 'neutral'}
            icon={isDelivering ? 'radio-outline' : 'ellipse-outline'}
          />
          {stopsSummary && (
            <Chip
              label={`${stopsSummary.delivered_packets}/${stopsSummary.total_packets} packets`}
              tone="gold"
              icon="basket-outline"
            />
          )}
        </View>

        {currentAddress && (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={16} color={colors.inkFaint} />
            <Text style={styles.addressText} numberOfLines={2}>{currentAddress}</Text>
          </View>
        )}

        <Button
          label={isDelivering ? 'Stop delivery' : 'Start delivery'}
          onPress={handleToggle}
          loading={toggling}
          disabled={loadingLocation || permissionDenied}
          fullWidth
          icon={isDelivering ? 'stop-circle-outline' : 'play-circle-outline'}
          variant={isDelivering ? 'secondary' : 'primary'}
          style={isDelivering ? styles.stopBtn : undefined}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  mapContainer: { flex: 1 },
  map:          { flex: 1 },
  mapPlaceholder: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: space[3], padding: space[6],
  },
  placeholderTitle: { ...type.h3, color: colors.ink, marginTop: space[2] },
  placeholderHint:  { ...type.body, color: colors.inkMuted, textAlign: 'center' },

  // Rider self marker
  selfMarker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.inkMuted,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.paper,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4 },
      android: { elevation: 6 },
    }),
  },
  selfMarkerLive: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.teal,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.paper,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4 },
      android: { elevation: 6 },
    }),
  },

  // Numbered pending stop pin — teal drop-pin with a downward triangle.
  stopMarkerWrap: { alignItems: 'center' },
  stopPin: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.paper,
    borderWidth: 2, borderColor: colors.teal,
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.20, shadowRadius: 3 },
      android: { elevation: 4 },
    }),
  },
  stopPinNext: {
    backgroundColor: colors.teal,
    borderColor: colors.gold,
    borderWidth: 3,
  },
  stopPinNum:     { ...type.bodyStrong, color: colors.tealDark, fontVariant: ['tabular-nums'] },
  stopPinNumNext: { color: colors.paper },
  stopPinTail: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    borderTopColor:   colors.teal,
    marginTop: -1,
  },
  stopPinTailNext: { borderTopColor: colors.gold },

  // Delivered stop pin — smaller, muted.
  doneStopWrap: { alignItems: 'center' },
  doneStopPin: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.success,
    borderWidth: 1.5, borderColor: colors.paper,
    alignItems: 'center', justifyContent: 'center',
  },
  doneStopTail: {
    width: 0, height: 0,
    borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 5,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    borderTopColor:   colors.success,
    marginTop: -1,
  },

  // Top-left route summary pill
  routePill: {
    position: 'absolute',
    top: 16, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.tealBorder,
    borderRadius: radius.pill,
    paddingHorizontal: space[3], paddingVertical: 6,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.15, shadowRadius: 3 },
      android: { elevation: 3 },
    }),
  },
  routePillText: { ...type.metaStrong, color: colors.tealDark },

  fitBtn: {
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
  btnPressed: { backgroundColor: colors.tealSoft },

  panel: {
    backgroundColor: colors.paper,
    paddingHorizontal: space[5],
    paddingTop: space[4],
    paddingBottom: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
    gap: space[3],
  },
  panelHead: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },

  addressRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  addressText: { flex: 1, ...type.body, color: colors.inkMuted },

  stopBtn: { borderColor: colors.danger },
});
