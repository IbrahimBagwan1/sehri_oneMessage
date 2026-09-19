import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trackingApi } from '../../api/tracking';
import { Card, Chip, EmptyState, ErrorState, Header, LoadingState } from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// Lazy-load react-native-maps so it doesn't crash Expo Go on import.
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
const REFRESH_INTERVAL_MS = 8000;

const DEFAULT_REGION = {
  latitude:      12.9082,
  longitude:     77.5484,
  latitudeDelta:  0.02,
  longitudeDelta: 0.02,
};

const STATUS = {
  idle:       { label: 'Rider is idle',      tone: 'neutral' },
  delivering: { label: 'On the way',         tone: 'teal'    },
  done:       { label: 'Delivery complete',  tone: 'success' },
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
              latitude:      Number(res.data.rider.latitude),
              longitude:     Number(res.data.rider.longitude),
              latitudeDelta:  0.01,
              longitudeDelta: 0.01,
            },
            600
          );
        }
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load the rider's location.");
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

  const hasLocation = rider?.latitude != null && rider?.longitude != null;
  const statusCfg = STATUS[rider?.status] || STATUS.idle;

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
        <ErrorState message={error} onRetry={() => fetchRider(true)} />
      </SafeAreaView>
    );
  }

  if (!rider) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <TrackHeader />
        <EmptyState
          icon="bicycle-outline"
          title="No active delivery"
          message="The rider hasn't started yet. Check back closer to Sehri time."
          actionLabel="Refresh"
          onAction={() => fetchRider(true)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <TrackHeader live />

      {/* Map or a graceful fallback for Expo Go */}
      {MAPS_AVAILABLE ? (
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={
              hasLocation
                ? {
                    latitude:      Number(rider.latitude),
                    longitude:     Number(rider.longitude),
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
                coordinate={{
                  latitude:  Number(rider.latitude),
                  longitude: Number(rider.longitude),
                }}
                title={rider.name}
                description={rider.current_address || ''}
              >
                <View style={styles.markerBubble}>
                  <Ionicons name="bicycle" size={22} color={colors.teal} />
                </View>
              </Marker>
            )}
          </MapView>
        </View>
      ) : (
        <View style={styles.mapFallback}>
          <Ionicons name="map-outline" size={40} color={colors.inkGhost} />
          <Text style={styles.mapFallbackTitle}>Map unavailable in Expo Go</Text>
          <Text style={styles.mapFallbackHint}>Use a development build to see the live map.</Text>
          {hasLocation && (
            <View style={styles.coordsBox}>
              <Text style={styles.coordsText}>
                {Number(rider.latitude).toFixed(5)}, {Number(rider.longitude).toFixed(5)}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Info panel — always shown, gives context without a shadowed hero card */}
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Chip label={statusCfg.label} tone={statusCfg.tone} icon={rider?.status === 'delivering' ? 'bicycle-outline' : 'time-outline'} />
          {rider.eta_minutes != null && (
            <View style={styles.etaBox}>
              <Text style={styles.etaValue}>{rider.eta_minutes}</Text>
              <Text style={styles.etaLabel}>min away</Text>
            </View>
          )}
        </View>

        <View style={styles.panelRow}>
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

        <Text style={styles.refreshNote}>Updates every {REFRESH_INTERVAL_MS / 1000}s</Text>
      </View>
    </SafeAreaView>
  );
}

function TrackHeader({ live }) {
  return (
    <Header
      title="Live tracking"
      trailing={live ? (
        <View style={styles.liveBadge}>
          <View style={styles.livePulse} />
          <Text style={styles.liveText}>Live</Text>
        </View>
      ) : null}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: space[2], paddingVertical: 4,
    borderRadius: radius.pill,
  },
  livePulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  liveText:  { ...type.micro, color: colors.danger, fontWeight: '700' },

  mapContainer: { flex: 1 },
  map:          { flex: 1 },
  markerBubble: {
    backgroundColor: colors.paper,
    borderRadius: 20,
    padding: 7,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3 },
      android: { elevation: 4 },
    }),
  },

  mapFallback: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: space[8], gap: space[2],
  },
  mapFallbackTitle: { ...type.bodyStrong, color: colors.inkMuted },
  mapFallbackHint:  { ...type.meta, textAlign: 'center' },
  coordsBox: {
    marginTop: space[3],
    backgroundColor: colors.ruleFaint,
    paddingHorizontal: space[3], paddingVertical: space[2],
    borderRadius: radius.md,
  },
  coordsText: { ...type.meta, color: colors.inkMuted, fontVariant: ['tabular-nums'] },

  panel: {
    backgroundColor: colors.paper,
    paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[3],
    borderTopWidth: 1, borderTopColor: colors.ruleSoft,
    gap: space[3],
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  etaBox:  { alignItems: 'center' },
  etaValue:{ fontSize: 24, fontWeight: '800', color: colors.tealDark, letterSpacing: -0.4 },
  etaLabel:{ ...type.micro, color: colors.inkFaint },

  panelRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
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

  refreshNote: { ...type.micro, color: colors.inkGhost, textAlign: 'center', marginTop: space[2] },
});
