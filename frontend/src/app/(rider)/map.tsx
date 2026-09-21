// @ts-nocheck
import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import { useRiderStore } from '../../store/useRiderStore';
import { Button, Chip, Header, LoadingState } from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Rider map — the rider's own live position, with a start/stop delivery
// toggle in the bottom panel.
//
// Rendered on native Google Maps via react-native-maps + PROVIDER_GOOGLE.
// The Android key is under app.json → android.config.googleMaps.apiKey
// and the iOS equivalent under ios.config.googleMapsApiKey; both are
// injected into the native project by the react-native-maps config
// plugin during `npx expo prebuild`. Requires a dev-client build — Expo
// Go does NOT ship the Google Maps native SDK.
//
// Broadcasts: useRiderStore.startDelivery() opens a watchPositionAsync
// stream and pushes each GPS ping to PATCH /api/tracking/:id/push-location
// which then emits `rider_position` into the rider's zone room for every
// user watching the track screen. This screen is the rider's view of
// that same coordinate stream.
// -----------------------------------------------------------------------------

const DEFAULT_REGION = {
  latitude:  12.9716,
  longitude: 77.5946,
  latitudeDelta:  0.02,
  longitudeDelta: 0.02,
};

export default function RiderMapScreen() {
  const router         = useRouter();
  const rider          = useRiderStore((s) => s.rider);
  const isDelivering   = useRiderStore((s) => s.isDelivering);
  const startDelivery  = useRiderStore((s) => s.startDelivery);
  const stopDelivery   = useRiderStore((s) => s.stopDelivery);
  const logout         = useRiderStore((s) => s.logout);

  const mapRef = useRef<any>(null);
  const followRef = useRef(0);

  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentAddress,  setCurrentAddress]  = useState<string | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [toggling,        setToggling]        = useState(false);

  useEffect(() => {
    let subscription: any = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLoadingLocation(false);
        setPermissionDenied(true);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCurrentLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });

      try {
        const [place] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude, longitude: loc.coords.longitude,
        });
        if (place) {
          setCurrentAddress([place.name, place.street, place.district, place.city].filter(Boolean).join(', '));
        }
      } catch {
        // On-device reverse-geocode is best-effort; backend backfills via
        // Google Reverse Geocode during pushLocation if we don't provide one.
      }

      setLoadingLocation(false);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 5 },
        (newLoc) => {
          const coords = { latitude: newLoc.coords.latitude, longitude: newLoc.coords.longitude };
          setCurrentLocation(coords);
          // Throttle camera-follow to at most once every ~1.5s so a
          // rapid GPS burst doesn't animate the map endlessly.
          const now = Date.now();
          if (mapRef.current && now - followRef.current > 1500) {
            followRef.current = now;
            mapRef.current.animateCamera(
              { center: coords },
              { duration: 700 }
            );
          }
        }
      );
    })();
    return () => subscription?.remove();
  }, []);

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (isDelivering) await stopDelivery(); else await startDelivery();
    } catch (err: any) {
      Alert.alert('Something went wrong', err?.message || 'Try again in a moment.');
    } finally {
      setToggling(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign out?', 'You\'ll need to sign back in to record deliveries.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } },
    ]);
  };

  const initialRegion = currentLocation
    ? { ...currentLocation, latitudeDelta: 0.02, longitudeDelta: 0.02 }
    : DEFAULT_REGION;

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
          </MapView>
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

  panel: {
    backgroundColor: colors.paper,
    paddingHorizontal: space[5],
    paddingTop: space[4],
    paddingBottom: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
    gap: space[3],
  },
  panelHead: { flexDirection: 'row' },

  addressRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  addressText: { flex: 1, ...type.body, color: colors.inkMuted },

  stopBtn: { borderColor: colors.danger },
});
