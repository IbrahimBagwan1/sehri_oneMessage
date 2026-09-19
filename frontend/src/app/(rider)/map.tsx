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
import { useRiderStore } from '../../store/useRiderStore';
import { Button, Chip, Header, LoadingState } from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// Lazy-load react-native-maps — not present in Expo Go.
let MapView = null;
let Marker = null;
let PROVIDER_GOOGLE = null;
try {
  const maps = require('react-native-maps');
  MapView         = maps.default;
  Marker          = maps.Marker;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
} catch (_) {}

const MAPS_AVAILABLE = MapView != null;

const DEFAULT_REGION = {
  latitude:      12.9716,
  longitude:     77.5946,
  latitudeDelta:  0.01,
  longitudeDelta: 0.01,
};

export default function RiderMapScreen() {
  const router         = useRouter();
  const rider          = useRiderStore((s) => s.rider);
  const isDelivering   = useRiderStore((s) => s.isDelivering);
  const startDelivery  = useRiderStore((s) => s.startDelivery);
  const stopDelivery   = useRiderStore((s) => s.stopDelivery);
  const logout         = useRiderStore((s) => s.logout);

  const mapRef = useRef<any>(null);

  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentAddress,  setCurrentAddress]  = useState<string | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [toggling,        setToggling]        = useState(false);

  useEffect(() => {
    let subscription = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLoadingLocation(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCurrentLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });

      const [place] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude, longitude: loc.coords.longitude,
      });
      if (place) {
        setCurrentAddress([place.name, place.street, place.district, place.city].filter(Boolean).join(', '));
      }

      setLoadingLocation(false);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 5 },
        (newLoc) => {
          const coords = { latitude: newLoc.coords.latitude, longitude: newLoc.coords.longitude };
          setCurrentLocation(coords);
          mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
        }
      );
    })();
    return () => subscription?.remove();
  }, []);

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (isDelivering) await stopDelivery(); else await startDelivery();
    } catch (err) {
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
        ) : MAPS_AVAILABLE ? (
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={currentLocation
              ? { ...currentLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 }
              : DEFAULT_REGION}
          >
            {currentLocation && (
              <Marker coordinate={currentLocation} title={rider?.name || 'You'} description={currentAddress || ''}>
                <View style={styles.marker}>
                  <Ionicons name="bicycle" size={24} color={isDelivering ? colors.teal : colors.inkFaint} />
                </View>
              </Marker>
            )}
          </MapView>
        ) : (
          <View style={styles.mapPlaceholder}>
            <Ionicons name="map-outline" size={40} color={colors.inkGhost} />
            <Text style={styles.placeholderTitle}>Map unavailable in Expo Go</Text>
            {currentLocation && (
              <Text style={styles.coords}>
                {currentLocation.latitude.toFixed(5)}, {currentLocation.longitude.toFixed(5)}
              </Text>
            )}
          </View>
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
          disabled={loadingLocation}
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
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: space[2], padding: space[6],
  },
  placeholderTitle: { ...type.body, color: colors.inkFaint },
  coords: { ...type.meta, color: colors.inkGhost, fontVariant: ['tabular-nums'] },

  marker: {
    backgroundColor: colors.paper,
    borderRadius: 20,
    padding: 6,
    borderWidth: 1,
    borderColor: colors.tealBorder,
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