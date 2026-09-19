import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRiderStore } from '../../store/useRiderStore';

// Lazy-load react-native-maps — not available in Expo Go
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
  const rider          = useRiderStore((state) => state.rider);
  const isDelivering   = useRiderStore((state) => state.isDelivering);
  const startDelivery  = useRiderStore((state) => state.startDelivery);
  const stopDelivery   = useRiderStore((state) => state.stopDelivery);
  const logout         = useRiderStore((state) => state.logout);

  const mapRef = useRef(null);

  const [currentLocation, setCurrentLocation] = useState(null);
  const [currentAddress,  setCurrentAddress]  = useState(null);
  const [loadingLocation, setLoadingLocation] = useState(true);
  const [toggling,        setToggling]        = useState(false);

  // Get initial position on mount for map centering
  useEffect(() => {
    let subscription = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLoadingLocation(false);
        return;
      }

      // Get current position once for initial map center
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCurrentLocation({
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
      });

      // Reverse geocode for display
      const [place] = await Location.reverseGeocodeAsync({
        latitude:  loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (place) {
        setCurrentAddress(
          [place.name, place.street, place.district, place.city]
            .filter(Boolean)
            .join(', ')
        );
      }

      setLoadingLocation(false);

      // Watch position so the map pin moves in real time on this screen
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 5 },
        (newLoc) => {
          const coords = {
            latitude:  newLoc.coords.latitude,
            longitude: newLoc.coords.longitude,
          };
          setCurrentLocation(coords);
          // Smoothly animate map to follow the rider
          mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
        }
      );
    })();

    return () => {
      subscription?.remove();
    };
  }, []);

  const handleToggleDelivery = async () => {
    setToggling(true);
    try {
      if (isDelivering) {
        await stopDelivery();
      } else {
        await startDelivery();
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Something went wrong');
    } finally {
      setToggling(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Rider Map</Text>
          <Text style={styles.headerSubtitle}>{rider?.name || 'Rider'}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} accessibilityLabel="Logout" style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={24} color="#DC2626" />
        </TouchableOpacity>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        {loadingLocation ? (
          <View style={styles.mapPlaceholder}>
            <ActivityIndicator size="large" color="#0D9488" />
            <Text style={styles.mapPlaceholderText}>Getting your location...</Text>
          </View>
        ) : MAPS_AVAILABLE ? (
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={
              currentLocation
                ? { ...currentLocation, latitudeDelta: 0.01, longitudeDelta: 0.01 }
                : DEFAULT_REGION
            }
            showsUserLocation={false}
            showsMyLocationButton={false}
          >
            {currentLocation && (
              <Marker
                coordinate={currentLocation}
                title={rider?.name || 'You'}
                description={currentAddress || ''}
              >
                <View style={styles.markerContainer}>
                  <Ionicons
                    name="bicycle"
                    size={24}
                    color={isDelivering ? '#0D9488' : '#64748B'}
                  />
                </View>
              </Marker>
            )}
          </MapView>
        ) : (
          <View style={styles.mapPlaceholder}>
            <Ionicons name="map-outline" size={40} color="#CBD5E1" />
            <Text style={styles.mapPlaceholderText}>Map unavailable in Expo Go</Text>
            {currentLocation && (
              <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                {currentLocation.latitude.toFixed(5)}, {currentLocation.longitude.toFixed(5)}
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Bottom panel */}
      <View style={styles.bottomPanel}>
        {/* Status badge */}
        <View style={[styles.statusBadge, isDelivering ? styles.statusDelivering : styles.statusIdle]}>
          <Ionicons
            name={isDelivering ? 'radio-button-on' : 'radio-button-off'}
            size={14}
            color={isDelivering ? '#FFFFFF' : '#64748B'}
          />
          <Text style={[styles.statusText, isDelivering && styles.statusTextDelivering]}>
            {isDelivering ? 'Broadcasting Location' : 'Idle'}
          </Text>
        </View>

        {/* Current address */}
        {currentAddress && (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={16} color="#64748B" />
            <Text style={styles.addressText} numberOfLines={2}>{currentAddress}</Text>
          </View>
        )}

        {/* Start / Stop button */}
        <TouchableOpacity
          style={[
            styles.deliveryButton,
            isDelivering ? styles.stopButton : styles.startButton,
            toggling && styles.buttonDisabled,
          ]}
          onPress={handleToggleDelivery}
          disabled={toggling || loadingLocation}
          accessibilityLabel={isDelivering ? 'Stop delivery' : 'Start delivery'}
          accessibilityRole="button"
        >
          {toggling ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons
                name={isDelivering ? 'stop-circle-outline' : 'play-circle-outline'}
                size={22}
                color="#FFFFFF"
              />
              <Text style={styles.deliveryButtonText}>
                {isDelivering ? 'Stop Delivery' : 'Start Delivery'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  logoutBtn: {
    padding: 6,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  mapPlaceholderText: {
    fontSize: 14,
    color: '#64748B',
  },
  markerContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  bottomPanel: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
    backgroundColor: '#F1F5F9',
  },
  statusDelivering: {
    backgroundColor: '#0D9488',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  statusTextDelivering: {
    color: '#FFFFFF',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  addressText: {
    flex: 1,
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
  deliveryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
    minHeight: 52,
  },
  startButton: {
    backgroundColor: '#0D9488',
  },
  stopButton: {
    backgroundColor: '#DC2626',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  deliveryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
