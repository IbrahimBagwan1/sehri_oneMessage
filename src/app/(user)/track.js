import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trackingApi } from '../../api/tracking';

// Lazy-load react-native-maps so it doesn't crash Expo Go on import.
// In Expo Go the map is replaced with a simple address card.
// In a dev/production build the full map renders.
let MapView = null;
let Marker = null;
let PROVIDER_GOOGLE = null;
try {
  const maps = require('react-native-maps');
  MapView        = maps.default;
  Marker         = maps.Marker;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
} catch (_) {
  // react-native-maps native module not available (Expo Go)
}

const MAPS_AVAILABLE = MapView != null;

// How often to re-poll the backend for rider location (ms).
const REFRESH_INTERVAL_MS = 8000;

const DEFAULT_REGION = {
  latitude:      12.9082,
  longitude:     77.5484,
  latitudeDelta:  0.02,
  longitudeDelta: 0.02,
};

const STATUS_CONFIG = {
  idle: {
    label: 'Rider is idle',
    icon:  'time-outline',
    color: '#64748B',
    bg:    '#F1F5F9',
  },
  delivering: {
    label: 'On the way',
    icon:  'bicycle',
    color: '#FFFFFF',
    bg:    '#0D9488',
  },
};

export default function TrackScreen() {
  const mapRef = useRef(null);

  const [rider,   setRider]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchRider = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const res = await trackingApi.getActiveRider();
      if (res.success) {
        setRider(res.data.rider);
        if (MAPS_AVAILABLE && res.data.rider?.latitude && res.data.rider?.longitude) {
          mapRef.current?.animateToRegion(
            {
              latitude:      res.data.rider.latitude,
              longitude:     res.data.rider.longitude,
              latitudeDelta:  0.01,
              longitudeDelta: 0.01,
            },
            600
          );
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load rider location');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchRider(true);
      const interval = setInterval(() => fetchRider(false), REFRESH_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [fetchRider])
  );

  const statusCfg   = STATUS_CONFIG[rider?.status] ?? STATUS_CONFIG.idle;
  const hasLocation = rider?.latitude != null && rider?.longitude != null;

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0D9488" />
          <Text style={styles.loadingText}>Fetching rider location...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Error
  // -------------------------------------------------------------------------
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Header />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#DC2626" />
          <Text style={styles.emptyTitle}>Something went wrong</Text>
          <Text style={styles.emptySubtitle}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchRider(true)}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // No active rider
  // -------------------------------------------------------------------------
  if (!rider) {
    return (
      <SafeAreaView style={styles.container}>
        <Header />
        <View style={styles.centered}>
          <Ionicons name="bicycle-outline" size={56} color="#CBD5E1" />
          <Text style={styles.emptyTitle}>No active delivery</Text>
          <Text style={styles.emptySubtitle}>
            The rider hasn't started yet. Check back closer to Sehri time.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => fetchRider(true)}>
            <Ionicons name="refresh-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.retryButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // -------------------------------------------------------------------------
  // Active rider
  // -------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container}>
      <Header live />

      {/* Map or fallback card */}
      {MAPS_AVAILABLE ? (
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={
              hasLocation
                ? {
                    latitude:      rider.latitude,
                    longitude:     rider.longitude,
                    latitudeDelta:  0.01,
                    longitudeDelta: 0.01,
                  }
                : DEFAULT_REGION
            }
            showsUserLocation
            showsMyLocationButton={false}
          >
            {hasLocation && (
              <Marker
                coordinate={{ latitude: rider.latitude, longitude: rider.longitude }}
                title={rider.name}
                description={rider.current_address || ''}
              >
                <View style={styles.markerContainer}>
                  <Ionicons name="bicycle" size={22} color="#0D9488" />
                </View>
              </Marker>
            )}
          </MapView>
        </View>
      ) : (
        // Fallback for Expo Go — show location as a card
        <View style={styles.mapFallback}>
          <Ionicons name="map-outline" size={40} color="#CBD5E1" />
          <Text style={styles.mapFallbackTitle}>Map unavailable in Expo Go</Text>
          <Text style={styles.mapFallbackSub}>Use a development build to see the live map.</Text>
          {hasLocation && (
            <View style={styles.coordsBox}>
              <Text style={styles.coordsText}>
                {rider.latitude.toFixed(5)}, {rider.longitude.toFixed(5)}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Info panel — always shown */}
      <View style={styles.infoPanel}>
        <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
          <Ionicons name={statusCfg.icon} size={14} color={statusCfg.color} />
          <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>

        <View style={styles.riderRow}>
          <View style={styles.riderAvatar}>
            <Ionicons name="person" size={18} color="#0D9488" />
          </View>
          <View style={styles.riderInfo}>
            <Text style={styles.riderName}>{rider.name}</Text>
            {rider.zone?.name && <Text style={styles.riderZone}>{rider.zone.name}</Text>}
          </View>
          {rider.eta_minutes != null && (
            <View style={styles.etaBox}>
              <Text style={styles.etaMinutes}>{rider.eta_minutes}</Text>
              <Text style={styles.etaLabel}>min</Text>
            </View>
          )}
        </View>

        {rider.current_address ? (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={15} color="#64748B" />
            <Text style={styles.addressText} numberOfLines={2}>{rider.current_address}</Text>
          </View>
        ) : null}

        <Text style={styles.refreshNote}>Updates every {REFRESH_INTERVAL_MS / 1000}s</Text>
      </View>
    </SafeAreaView>
  );
}

// -------------------------------------------------------------------------
// Header component
// -------------------------------------------------------------------------
function Header({ live = false }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Live Tracking</Text>
      {live && (
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      )}
    </View>
  );
}

// -------------------------------------------------------------------------
// Styles
// -------------------------------------------------------------------------
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
  },
  headerTitle:  { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FEF2F2', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20, gap: 5,
  },
  liveDot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: '#DC2626' },
  liveText: { fontSize: 11, fontWeight: '700', color: '#DC2626', letterSpacing: 0.6 },

  mapContainer: { flex: 1 },
  map:          { flex: 1 },
  markerContainer: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 7,
    elevation: 4, shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3,
  },

  // Fallback when maps not available
  mapFallback: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#F8FAFC', gap: 8, paddingHorizontal: 32,
  },
  mapFallbackTitle: { fontSize: 15, fontWeight: '600', color: '#94A3B8' },
  mapFallbackSub:   { fontSize: 12, color: '#CBD5E1', textAlign: 'center' },
  coordsBox: {
    marginTop: 8, backgroundColor: '#E2E8F0',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  coordsText: { fontSize: 13, color: '#475569', fontFamily: 'monospace' },

  infoPanel: {
    backgroundColor: '#FFFFFF', paddingHorizontal: 20,
    paddingTop: 16, paddingBottom: 12,
    borderTopWidth: 1, borderTopColor: '#E2E8F0',
    gap: 10, elevation: 8, shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.06, shadowRadius: 4,
  },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, gap: 6,
  },
  statusText:   { fontSize: 12, fontWeight: '600' },
  riderRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  riderAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#F0FDF9', alignItems: 'center', justifyContent: 'center',
  },
  riderInfo:  { flex: 1 },
  riderName:  { fontSize: 15, fontWeight: '600', color: '#0F172A' },
  riderZone:  { fontSize: 12, color: '#64748B', marginTop: 2 },
  etaBox: {
    alignItems: 'center', backgroundColor: '#F0FDF9',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, minWidth: 50,
  },
  etaMinutes: { fontSize: 18, fontWeight: '700', color: '#0D9488' },
  etaLabel:   { fontSize: 10, color: '#0D9488', fontWeight: '600' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  addressText: { flex: 1, fontSize: 13, color: '#475569', lineHeight: 18 },
  refreshNote: { fontSize: 11, color: '#94A3B8', textAlign: 'center' },

  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  emptyTitle:    { fontSize: 17, fontWeight: '600', color: '#334155', textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
  loadingText:   { fontSize: 14, color: '#64748B', marginTop: 8 },
  retryButton: {
    marginTop: 8, backgroundColor: '#0D9488',
    paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 8, flexDirection: 'row', alignItems: 'center',
  },
  retryButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
});
