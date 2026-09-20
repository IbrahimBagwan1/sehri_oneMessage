import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { locationsAdminApi } from '../../api/locations';
import {
  Button, Card, Chip, EmptyState, ErrorState, Header, LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Super-admin PG coordinate picker.
//
// This is a one-time-per-PG setup screen: super admin taps a PG that
// needs coordinates, a map opens, they drag/tap to place a pin, save.
// After that the PG never needs re-pinning — same residents every day
// hit the same address. The ETA calculator uses these pins.
// -----------------------------------------------------------------------------

// Lazy-load react-native-maps — Expo Go doesn't ship it.
let MapView = null, Marker = null, UrlTile = null, PROVIDER_GOOGLE = null;
try {
  const maps = require('react-native-maps');
  MapView         = maps.default;
  Marker          = maps.Marker;
  UrlTile         = maps.UrlTile;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
} catch (_) { /* not installed in Expo Go */ }

const MAPS_AVAILABLE = MapView != null;

// Bangalore center — pin defaults here if the PG doesn't have coords yet.
const BANGALORE_CENTER = { latitude: 12.9716, longitude: 77.5946 };
const DEFAULT_REGION = {
  ...BANGALORE_CENTER,
  latitudeDelta:  0.08,
  longitudeDelta: 0.08,
};

const FILTERS = [
  { key: 'unpinned', label: 'Needs pin' },
  { key: 'pinned',   label: 'Pinned'    },
  { key: 'all',      label: 'All'       },
];

export default function LocationsCoordScreen() {
  const router = useRouter();

  const [filter,     setFilter]     = useState('unpinned');
  const [addresses,  setAddresses]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  const [picking,     setPicking]     = useState(null); // { id, name, latitude, longitude }
  const [pickCoord,   setPickCoord]   = useState(null); // { latitude, longitude } as being dragged
  const [saving,      setSaving]      = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await locationsAdminApi.listAddresses();
      if (res.success) setAddresses(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load PG list.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = addresses.filter((a) => {
    if (filter === 'unpinned') return a.latitude == null || a.longitude == null;
    if (filter === 'pinned')   return a.latitude != null && a.longitude != null;
    return true;
  });

  const unpinnedCount = addresses.filter((a) => a.latitude == null || a.longitude == null).length;

  const openPicker = (row) => {
    setPickCoord(
      row.latitude != null && row.longitude != null
        ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
        : { ...BANGALORE_CENTER }
    );
    setPicking(row);
  };

  const closePicker = () => {
    setPicking(null);
    setPickCoord(null);
    setSaving(false);
  };

  const handleSave = async () => {
    if (!picking || !pickCoord) return;
    setSaving(true);
    try {
      await locationsAdminApi.setCoordinates(picking.id, pickCoord.latitude, pickCoord.longitude);
      // Optimistic list update so the row moves out of "unpinned" instantly.
      setAddresses((prev) => prev.map((a) =>
        a.id === picking.id
          ? { ...a, latitude: pickCoord.latitude, longitude: pickCoord.longitude, geocoded_at: new Date().toISOString() }
          : a
      ));
      closePicker();
    } catch (err) {
      Alert.alert("Couldn't save", err?.response?.data?.message || 'Try again in a moment.');
      setSaving(false);
    }
  };

  const renderRow = ({ item }) => {
    const hasPin = item.latitude != null && item.longitude != null;
    return (
      <Pressable
        onPress={() => openPicker(item)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${hasPin ? 'pinned' : 'needs pin'}, tap to open map`}
      >
        <View style={[styles.pinDot, hasPin ? styles.pinDotSet : styles.pinDotEmpty]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={2}>{item.name}</Text>
          {item.parent?.name && (
            <Text style={styles.rowSub}>{item.parent.name}</Text>
          )}
          {hasPin ? (
            <Text style={styles.rowCoords}>
              {Number(item.latitude).toFixed(5)}, {Number(item.longitude).toFixed(5)}
            </Text>
          ) : (
            <Text style={styles.rowMissing}>No pin yet — tap to set</Text>
          )}
        </View>
        <Ionicons name={hasPin ? 'chevron-forward' : 'add-circle-outline'} size={18} color={colors.inkGhost} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="PG coordinates" onBack={() => router.back()} />

      {/* Summary strip */}
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {addresses.length - unpinnedCount} of {addresses.length} PGs pinned
        </Text>
        {unpinnedCount > 0 && (
          <Chip label={`${unpinnedCount} pending`} tone="warn" />
        )}
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            tone={filter === f.key ? 'teal' : 'neutral'}
            selected={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </View>

      {loading ? (
        <LoadingState message="Loading PGs…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(a) => a.id}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.teal]}
              tintColor={colors.teal}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="checkmark-done-circle-outline"
              title={filter === 'unpinned' ? 'All PGs pinned' : 'No PGs found'}
              message={
                filter === 'unpinned'
                  ? "Every address in the community has a map pin. Live tracking will show ETA to each one."
                  : 'Nothing matches this filter right now.'
              }
            />
          }
        />
      )}

      {/* --------------- Map picker modal --------------- */}
      <Modal
        visible={!!picking}
        animationType="slide"
        transparent={false}
        onRequestClose={closePicker}
      >
        <SafeAreaView style={styles.pickerScreen} edges={['top', 'bottom']}>
          <Header
            title={picking?.name || 'Set pin'}
            subtitle="Tap or drag the pin to the exact location"
            onBack={closePicker}
          />

          {MAPS_AVAILABLE && pickCoord ? (
            <View style={styles.mapWrap}>
              <MapView
                style={styles.map}
                initialRegion={{
                  latitude:      pickCoord.latitude,
                  longitude:     pickCoord.longitude,
                  latitudeDelta:  0.02,
                  longitudeDelta: 0.02,
                }}
                onPress={(e) => setPickCoord(e.nativeEvent.coordinate)}
                showsUserLocation
              >
                {UrlTile && (
                  <UrlTile
                    urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maximumZ={19}
                    shouldReplaceMapContent
                  />
                )}
                <Marker
                  coordinate={pickCoord}
                  draggable
                  onDragEnd={(e) => setPickCoord(e.nativeEvent.coordinate)}
                  anchor={{ x: 0.5, y: 1 }}
                >
                  <View style={styles.pickerPin}>
                    <Ionicons name="location" size={22} color={colors.paper} />
                  </View>
                </Marker>
              </MapView>
              <View style={styles.pickerCoords}>
                <Text style={styles.pickerCoordsLabel}>Selected</Text>
                <Text style={styles.pickerCoordsValue}>
                  {pickCoord.latitude.toFixed(5)}, {pickCoord.longitude.toFixed(5)}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.mapPlaceholder}>
              <Ionicons name="map-outline" size={40} color={colors.inkGhost} />
              <Text style={styles.placeholderText}>
                Map unavailable in Expo Go. Use a development build to pick coordinates.
              </Text>
            </View>
          )}

          <View style={styles.pickerActions}>
            <Button label="Cancel" onPress={closePicker} variant="secondary" style={{ flex: 1 }} />
            <Button
              label="Save pin"
              onPress={handleSave}
              loading={saving}
              disabled={!MAPS_AVAILABLE || !pickCoord}
              icon="checkmark"
              style={{ flex: 1 }}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4], paddingVertical: space[3],
  },
  summaryText: { ...type.metaStrong, color: colors.inkMuted },

  filterRow: {
    flexDirection: 'row', gap: space[2],
    paddingHorizontal: space[4], paddingBottom: space[3],
  },

  list: { padding: space[4], paddingBottom: space[8] },
  sep:  { height: 1, backgroundColor: colors.ruleFaint, marginLeft: space[4] + 12 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    padding: space[3],
    borderWidth: 1, borderColor: colors.ruleSoft,
  },
  rowPressed:    { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  pinDot:        { width: 10, height: 10, borderRadius: 5 },
  pinDotSet:     { backgroundColor: colors.success },
  pinDotEmpty:   { backgroundColor: colors.warn },
  rowTitle:      { ...type.bodyStrong },
  rowSub:        { ...type.micro, color: colors.inkFaint, marginTop: 2 },
  rowCoords:     { ...type.micro, color: colors.inkFaint, marginTop: 4, fontVariant: ['tabular-nums'] },
  rowMissing:    { ...type.micro, color: colors.warn, marginTop: 4, fontWeight: '700' },

  // Picker modal
  pickerScreen: { flex: 1, backgroundColor: colors.paperSoft },
  mapWrap:      { flex: 1 },
  map:          { flex: 1 },
  pickerPin: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.teal,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.paper,
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4 },
      android: { elevation: 6 },
    }),
  },
  pickerCoords: {
    position: 'absolute',
    top: 16, left: 16, right: 16,
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.ruleSoft,
    padding: space[3],
    ...Platform.select({
      ios:     { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 3 },
      android: { elevation: 3 },
    }),
  },
  pickerCoordsLabel: { ...type.micro, color: colors.gold, fontWeight: '700', marginBottom: 2 },
  pickerCoordsValue: { ...type.bodyStrong, color: colors.ink, fontVariant: ['tabular-nums'] },

  mapPlaceholder: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: space[8], gap: space[3],
  },
  placeholderText: { ...type.body, color: colors.inkFaint, textAlign: 'center' },

  pickerActions: {
    flexDirection: 'row', gap: space[2],
    padding: space[4],
    borderTopWidth: 1, borderTopColor: colors.ruleSoft,
    backgroundColor: colors.paper,
  },
});
