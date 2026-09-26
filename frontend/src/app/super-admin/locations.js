import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { locationsAdminApi } from '../../api/locations';
import { locationsApi } from '../../api/auth';
import {
  Button, Card, Chip, EmptyState, ErrorState, Header, Input, LoadingState,
  KeyboardAvoidingView
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

// Native Google Maps via react-native-maps. Android key lives in
// app.json → android.config.googleMaps.apiKey; iOS in
// ios.config.googleMapsApiKey. Both injected by the react-native-maps
// config plugin at prebuild — requires a dev-client build (Expo Go
// doesn't ship the Google Maps native SDK).
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';

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

  // CRUD state — separate from the coord picker so the map picker
  // stays a narrow single-responsibility modal.
  const [createOpen,  setCreateOpen]  = useState(false);
  const [editing,     setEditing]     = useState(null); // full PG row being renamed / reparented
  const [rowActions,  setRowActions]  = useState(null); // full PG row whose ⋯ menu is open
  const [zones,       setZones]       = useState([]);   // for the zone chip picker in create/rename
  const [zonesLoading, setZonesLoading] = useState(false);

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

  // Lazy-load zones the first time a Create or Rename modal opens.
  // Cached in state so the second open is instant.
  useEffect(() => {
    if ((!createOpen && !editing) || zones.length > 0) return;
    (async () => {
      setZonesLoading(true);
      try {
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch { setZones([]); }
      finally  { setZonesLoading(false); }
    })();
  }, [createOpen, editing, zones.length]);

  // --- Row actions (rename / delete) ---------------------------------------
  const handleDelete = (row) => {
    setRowActions(null);
    Alert.alert(
      `Remove "${row.name}"?`,
      'This hides the PG from the app. Users linked to it will need to be moved first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await locationsAdminApi.deleteAddress(row.id);
              setAddresses((prev) => prev.filter((a) => a.id !== row.id));
            } catch (err) {
              const status = err?.response?.status;
              const msg = err?.response?.data?.message || 'Try again in a moment.';
              // 409 → users still linked. Offer force delete as a second
              // step so the admin has to explicitly acknowledge the state.
              if (status === 409) {
                Alert.alert(
                  'PG still has users',
                  msg + '\n\nRemove anyway?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove anyway',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await locationsAdminApi.deleteAddress(row.id, { force: true });
                          setAddresses((prev) => prev.filter((a) => a.id !== row.id));
                        } catch (e2) {
                          Alert.alert("Couldn't remove", e2?.response?.data?.message || 'Try again.');
                        }
                      },
                    },
                  ]
                );
              } else {
                Alert.alert("Couldn't remove", msg);
              }
            }
          },
        },
      ]
    );
  };

  const handleOpenRename = (row) => {
    setRowActions(null);
    setEditing(row);
  };

  // Called by the modals when a create/update succeeds — merges the new
  // row into local state so the list updates without a full reload.
  const onCreated = (row) => {
    setCreateOpen(false);
    setAddresses((prev) => [row, ...prev].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const onRenamed = (row) => {
    setEditing(null);
    setAddresses((prev) =>
      prev.map((a) => (a.id === row.id ? { ...a, ...row } : a))
          .sort((a, b) => a.name.localeCompare(b.name))
    );
  };

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
      <View style={styles.rowWrap}>
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

        {/* ⋯ actions button — opens a small sheet with Rename / Remove.
            Deliberately separate from the row's main press target (which
            opens the map picker) so tapping the map is one-motion and
            destructive/edit actions require an explicit second tap. */}
        <Pressable
          onPress={() => setRowActions(item)}
          hitSlop={10}
          style={({ pressed }) => [styles.rowMenuBtn, pressed && styles.rowMenuBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${item.name}`}
        >
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.inkMuted} />
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header
        title="PG coordinates"
        onBack={() => router.back()}
        trailing={
          <Pressable
            onPress={() => setCreateOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Add a new PG"
          >
            <Ionicons name="add" size={26} color={colors.teal} />
          </Pressable>
        }
      />

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

          {pickCoord ? (
            <View style={styles.mapWrap}>
              <MapView
                provider={PROVIDER_GOOGLE}
                style={styles.map}
                initialRegion={{
                  latitude:  pickCoord.latitude,
                  longitude: pickCoord.longitude,
                  latitudeDelta:  0.008,
                  longitudeDelta: 0.008,
                }}
                onPress={(e) => setPickCoord(e.nativeEvent.coordinate)}
                showsCompass={false}
                showsMyLocationButton={false}
                showsPointsOfInterest
                toolbarEnabled={false}
                loadingEnabled
                loadingIndicatorColor={colors.teal}
                loadingBackgroundColor={colors.paperSoft}
              >
                <Marker
                  identifier="pin"
                  coordinate={pickCoord}
                  anchor={{ x: 0.5, y: 1 }}
                  // Draggable so admins can fine-tune after the initial
                  // tap-to-place instead of tapping repeatedly. Coordinate
                  // is committed on drag end (tapping elsewhere also works).
                  draggable
                  onDragEnd={(e) => setPickCoord(e.nativeEvent.coordinate)}
                  tracksViewChanges={false}
                  title={picking?.name || 'Selected location'}
                  description="Drag to fine-tune"
                >
                  <View style={styles.pickerPinWrap}>
                    <View style={styles.pickerPin}>
                      <Ionicons name="location" size={22} color={colors.paper} />
                    </View>
                    <View style={styles.pickerPinTail} />
                  </View>
                </Marker>
              </MapView>
              <View style={styles.pickerCoords}>
                <Text style={styles.pickerCoordsLabel}>Selected · tap or drag to move</Text>
                <Text style={styles.pickerCoordsValue}>
                  {pickCoord.latitude.toFixed(5)}, {pickCoord.longitude.toFixed(5)}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.mapPlaceholder}>
              <Ionicons name="map-outline" size={40} color={colors.inkGhost} />
              <Text style={styles.placeholderText}>Loading map…</Text>
            </View>
          )}

          <View style={styles.pickerActions}>
            <Button label="Cancel" onPress={closePicker} variant="secondary" style={{ flex: 1 }} />
            <Button
              label="Save pin"
              onPress={handleSave}
              loading={saving}
              disabled={!pickCoord}
              icon="checkmark"
              style={{ flex: 1 }}
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* --------------- Row action sheet (Rename / Remove) --------------- */}
      <Modal
        visible={!!rowActions}
        animationType="fade"
        transparent
        onRequestClose={() => setRowActions(null)}
      >
        <Pressable style={styles.actionOverlay} onPress={() => setRowActions(null)}>
          <Pressable style={styles.actionSheet} onPress={() => { /* absorb */ }}>
            <View style={styles.modalHandle} />
            <Text style={styles.actionTitle} numberOfLines={2}>{rowActions?.name}</Text>
            <Text style={styles.actionSub}>{rowActions?.parent?.name}</Text>

            <ActionRow
              icon="create-outline"
              label="Rename or move"
              hint="Change the name or reassign it to a different zone"
              onPress={() => handleOpenRename(rowActions)}
            />
            <ActionRow
              icon="location-outline"
              label={rowActions?.latitude != null ? 'Move pin on the map' : 'Set pin on the map'}
              hint="Adjust the delivery coordinate"
              onPress={() => { const r = rowActions; setRowActions(null); openPicker(r); }}
            />
            <ActionRow
              icon="trash-outline"
              label="Remove PG"
              hint="Hides it from the app. Users linked to it need to be moved first."
              tone="danger"
              onPress={() => handleDelete(rowActions)}
            />

            <Button label="Cancel" variant="secondary" onPress={() => setRowActions(null)} fullWidth style={{ marginTop: space[3] }} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* --------------- Create PG sheet --------------- */}
      <PGFormSheet
        visible={createOpen}
        mode="create"
        zones={zones}
        zonesLoading={zonesLoading}
        onClose={() => setCreateOpen(false)}
        onSaved={onCreated}
      />

      {/* --------------- Rename / Reparent PG sheet --------------- */}
      <PGFormSheet
        visible={!!editing}
        mode="edit"
        initial={editing}
        zones={zones}
        zonesLoading={zonesLoading}
        onClose={() => setEditing(null)}
        onSaved={onRenamed}
      />
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// ActionRow — reusable row inside the ⋯ action sheet.
// -----------------------------------------------------------------------------
function ActionRow({ icon, label, hint, tone = 'neutral', onPress }) {
  const isDanger = tone === 'danger';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionRow,
        pressed && { backgroundColor: isDanger ? colors.dangerSoft : colors.tealSoft },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.actionIcon, isDanger && styles.actionIconDanger]}>
        <Ionicons name={icon} size={18} color={isDanger ? colors.danger : colors.tealDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, isDanger && { color: colors.danger }]}>{label}</Text>
        {hint ? <Text style={styles.actionHint} numberOfLines={2}>{hint}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.inkGhost} />
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// PGFormSheet — shared create + rename bottom sheet.
//
// One component with a `mode` flag rather than two nearly-identical
// modals. In "create" mode the API call is POST /locations/address; in
// "edit" mode it's PATCH /locations/:id. Coordinates aren't editable
// here — those flow through the existing map picker.
// -----------------------------------------------------------------------------
function PGFormSheet({ visible, mode, initial, zones, zonesLoading, onClose, onSaved }) {
  const isEdit = mode === 'edit';

  const [name,   setName]   = useState('');
  const [zoneId, setZoneId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Reset fields whenever the sheet opens, seeding from `initial` in edit mode.
  useEffect(() => {
    if (!visible) return;
    setName(isEdit ? (initial?.name || '') : '');
    setZoneId(isEdit ? (initial?.parent_id || null) : null);
    setSaving(false);
  }, [visible, isEdit, initial?.id, initial?.name, initial?.parent_id]);

  const trimmed = name.trim();
  const canSubmit =
    trimmed.length >= 2 &&
    trimmed.length <= 150 &&
    !!zoneId &&
    !saving &&
    // In edit mode, require at least one change so we don't send noise.
    (!isEdit || trimmed !== (initial?.name || '') || zoneId !== initial?.parent_id);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = isEdit
        ? await locationsAdminApi.updateAddress(initial.id, { name: trimmed, parent_id: zoneId })
        : await locationsAdminApi.createAddress({ name: trimmed, parent_id: zoneId });
      if (res.success) {
        onSaved?.(res.data);
      }
    } catch (err) {
      Alert.alert(
        isEdit ? "Couldn't update PG" : "Couldn't create PG",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => (saving ? null : onClose())}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.modalSheet}
        >
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>{isEdit ? 'Rename or move' : 'Add a PG'}</Text>
          <Text style={styles.modalBody}>
            {isEdit
              ? 'Update the display name and/or move it to a different zone. Use the map picker to change the pin.'
              : "Give the PG a clear name and pick its zone. You can drop the map pin now from the list, or after saving."}
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space[3] }}>
            <View>
              <Text style={styles.formLabel}>PG name</Text>
              <Input
                value={name}
                onChangeText={setName}
                placeholder="e.g. Rehmat PG"
                autoCapitalize="words"
                maxLength={150}
                icon="home-outline"
              />
            </View>

            <View>
              <Text style={styles.formLabel}>Zone</Text>
              {zonesLoading ? (
                <LoadingState message="Loading zones…" compact />
              ) : zones.length === 0 ? (
                <Text style={styles.formEmpty}>No zones available.</Text>
              ) : (
                <View style={styles.zoneChips}>
                  {zones.map((z) => (
                    <Chip
                      key={z.id}
                      label={z.name}
                      tone={zoneId === z.id ? 'teal' : 'neutral'}
                      selected={zoneId === z.id}
                      icon="location-outline"
                      onPress={() => setZoneId(z.id)}
                    />
                  ))}
                </View>
              )}
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} disabled={saving} />
            <Button
              label={saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create PG')}
              onPress={handleSubmit}
              loading={saving}
              disabled={!canSubmit}
              icon="checkmark"
              style={{ flex: 1.2 }}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
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

  // Row + ⋯ menu button share a wrapper so the menu button can float
  // to the right edge without shrinking the tappable row area.
  rowWrap: { position: 'relative' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    padding: space[3],
    paddingRight: 44, // room for the ⋯ menu button
    borderWidth: 1, borderColor: colors.ruleSoft,
  },
  rowPressed:    { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  rowMenuBtn: {
    position: 'absolute',
    top: 4, right: 4,
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  rowMenuBtnPressed: { backgroundColor: colors.ruleFaint },
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

  // Custom draggable pin — teal disk with a downward triangle so the tip
  // is the actual coordinate. Cleaner than Google's default red pin,
  // and matches the app's teal/gold identity.
  pickerPinWrap: { alignItems: 'center' },
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
  pickerPinTail: {
    width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 8,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
    borderTopColor:   colors.teal,
    marginTop: -2,
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

  // ---- Row action sheet (Rename / Set pin / Remove) ----
  actionOverlay: {
    flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[5],
    gap: space[2],
  },
  actionTitle: { ...type.h3, textAlign: 'center', marginTop: space[1] },
  actionSub:   { ...type.meta, color: colors.inkFaint, textAlign: 'center', marginBottom: space[2] },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  actionIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  actionIconDanger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  actionLabel: { ...type.bodyStrong },
  actionHint:  { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  // ---- Create / Rename form sheet ----
  modalOverlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[5],
    maxHeight: '92%',
    gap: space[3],
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[2],
  },
  modalTitle: { ...type.h2, textAlign: 'center' },
  modalBody:  { ...type.body, color: colors.inkMuted, textAlign: 'center' },
  formLabel:  { ...type.metaStrong, color: colors.inkMuted, marginBottom: space[2] },
  formEmpty:  { ...type.meta, color: colors.inkFaint },
  zoneChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  modalActions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
});
