// @ts-nocheck
import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRiderStore } from '../../store/useRiderStore';
import { Button, Chip, Header, LoadingState } from '../../components/ui';
import LeafletMap from '../../components/LeafletMap';
import { colors, radius, space, type } from '../../theme';

// Historical note: this screen used to render `react-native-maps` with a
// Google provider. On Android react-native-maps 1.x always uses Google as
// the base tile source, and the map rendered as a solid black rectangle
// whenever the Google Maps API key wasn't fully wired (Expo Go, or a
// dev-client built before the plugin config was added, or a Google Cloud
// project with billing / Maps SDK for Android not enabled). We switched
// to LeafletMap (WebView + OpenStreetMap) so tiles render everywhere
// without any external cloud dependency.

const DEFAULT_CENTER = { latitude: 12.9716, longitude: 77.5946 };

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
          mapRef.current?.animateTo({ latitude: coords.latitude, longitude: coords.longitude });
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
        ) : (
          <LeafletMap
            ref={mapRef}
            center={currentLocation || DEFAULT_CENTER}
            zoom={16}
            markers={currentLocation ? [{
              id: 'self',
              latitude:  currentLocation.latitude,
              longitude: currentLocation.longitude,
              kind:      'rider',
              label:     isDelivering ? '●' : '',
              title:     rider?.name || 'You',
            }] : []}
          />
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