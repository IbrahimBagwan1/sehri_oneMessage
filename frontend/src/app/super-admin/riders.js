import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  Modal,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trackingApi } from '../../api/tracking';
import { locationsApi } from '../../api/auth';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  SectionHeader,
} from '../../components/ui';
import PasswordInput from '../../components/PasswordInput';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Super admin — Riders management. Wires up all 6 backend endpoints in
// /api/tracking/* that were previously frontend-less:
//   GET  /api/tracking/all              — list riders
//   POST /api/tracking                  — create rider (standalone mode)
//   PATCH /api/tracking/:id/assign-today
//   PATCH /api/tracking/:id/toggle
//   DELETE /api/tracking/:id
//   (The manual location override is available via the row action menu.)
// -----------------------------------------------------------------------------

const STATUS_TONE = {
  idle:       { label: 'Idle',           tone: 'neutral' },
  delivering: { label: 'Delivering',     tone: 'teal'    },
  done:       { label: 'Done for today', tone: 'success' },
};

export default function SuperAdminRidersScreen() {
  const router = useRouter();

  const [riders, setRiders]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [busyId, setBusyId]         = useState(null);

  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await trackingApi.getAllRiders();
      if (res.success) setRiders(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load riders.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // --- Actions ---------------------------------------------------------
  // ---- Multi-rider assign ------------------------------------------------
  // Backend supports any number of assigned riders per day via
  // delivery_stops. The old "assign today" replaced whichever single
  // rider was there — new behavior: this button ADDS the rider to the
  // current run, keeping everyone else assigned. Remove works the same
  // way in reverse. Both flow through POST /delivery-run/assign which
  // regenerates the stops from the full rider set (idempotent).
  const currentlyAssignedIds = () =>
    riders.filter((r) => r.is_assigned_today).map((r) => r.id);

  const applyDeliveryRun = async (nextIds, action, riderName) => {
    setBusyId(nextIds.length > 0 ? nextIds[0] : 'run'); // spin something
    try {
      if (nextIds.length === 0) {
        // Empty = wipe today's run entirely.
        await trackingApi.unassignTodayRider();
      } else {
        const res = await trackingApi.assignDeliveryRun(nextIds);
        // Surface orphaned PGs if any — those are zones the current
        // rider set can't cover. Non-blocking notice.
        const orphans = res?.data?.orphaned_pgs || [];
        if (orphans.length > 0) {
          Alert.alert(
            'Some PGs uncovered',
            `${orphans.length} PG${orphans.length === 1 ? '' : 's'} in the run has no eligible rider ` +
            `(no assigned rider matches their zone). Assign a rider whose zone covers those PGs, ` +
            `or a rider with "all zones" access.`,
          );
        }
      }
      await load(true);
    } catch (err) {
      Alert.alert(
        `Couldn't ${action} ${riderName}`,
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleAssign = (rider) => {
    const already = currentlyAssignedIds();
    if (already.includes(rider.id)) return; // no-op
    const nextIds = [...already, rider.id];
    const others = already.length;
    Alert.alert(
      `Add ${rider.name} to today's run?`,
      others === 0
        ? "You'll be the only rider on today's run."
        : `They'll deliver alongside ${others} other rider${others === 1 ? '' : 's'}. PGs are auto-split by zone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add', onPress: () => applyDeliveryRun(nextIds, 'add', rider.name) },
      ]
    );
  };

  const handleUnassign = (rider) => {
    const already = currentlyAssignedIds();
    const nextIds = already.filter((id) => id !== rider.id);
    const remaining = nextIds.length;
    Alert.alert(
      `Remove ${rider.name} from today's run?`,
      remaining === 0
        ? "No riders will be assigned for today. The delivery run is cleared."
        : `Their PGs get reassigned to the remaining ${remaining} rider${remaining === 1 ? '' : 's'} (auto-split by zone).`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => applyDeliveryRun(nextIds, 'remove', rider.name) },
      ]
    );
  };

  const handleToggle = (rider) => {
    const nextState = rider.is_active ? 'deactivate' : 'activate';
    Alert.alert(
      `${nextState.charAt(0).toUpperCase() + nextState.slice(1)} ${rider.name}?`,
      rider.is_active
        ? "They'll go off-duty. If they were assigned to today, that assignment is cleared."
        : 'They can be assigned to a delivery day again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextState.charAt(0).toUpperCase() + nextState.slice(1),
          style: rider.is_active ? 'destructive' : 'default',
          onPress: async () => {
            setBusyId(rider.id);
            try {
              await trackingApi.toggleRider(rider.id);
              await load(true);
            } catch (err) {
              Alert.alert("Couldn't update", err?.response?.data?.message || 'Try again.');
            } finally { setBusyId(null); }
          },
        },
      ]
    );
  };

  const handleDelete = (rider) => {
    Alert.alert(
      `Delete ${rider.name}?`,
      "This can't be undone. Their linked user account (if any) stays intact.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(rider.id);
            try {
              await trackingApi.deleteRider(rider.id);
              setRiders((prev) => prev.filter((r) => r.id !== rider.id));
            } catch (err) {
              Alert.alert("Couldn't delete", err?.response?.data?.message || 'Try again.');
            } finally { setBusyId(null); }
          },
        },
      ]
    );
  };

  const onCreated = (rider) => {
    setCreateOpen(false);
    setRiders((prev) => [rider, ...prev]);
  };

  // --- Grouping --------------------------------------------------------
  const grouped = useMemo(() => {
    const active   = riders.filter((r) => r.is_active);
    const inactive = riders.filter((r) => !r.is_active);
    return { active, inactive };
  }, [riders]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header
        title="Riders"
        onBack={() => router.back()}
        trailing={
          <Pressable onPress={() => setCreateOpen(true)} hitSlop={8} accessibilityLabel="Add rider">
            <Ionicons name="add" size={24} color={colors.teal} />
          </Pressable>
        }
      />

      {loading ? (
        <LoadingState message="Loading riders…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : riders.length === 0 ? (
        <EmptyState
          icon="bicycle-outline"
          title="No riders yet"
          message="Tap the + button to add your first rider."
          actionLabel="Add rider"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <FlatList
          data={[{ kind: 'section', label: `On duty · ${grouped.active.length}` }, ...grouped.active,
                 ...(grouped.inactive.length ? [{ kind: 'section', label: `Off duty · ${grouped.inactive.length}` }] : []),
                 ...grouped.inactive]}
          keyExtractor={(item, i) => item.kind === 'section' ? `sec-${i}` : item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />
          }
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              return (
                <View style={{ marginTop: space[3] }}>
                  <SectionHeader title={item.label} />
                </View>
              );
            }
            return (
              <RiderRow
                rider={item}
                busy={busyId === item.id}
                onAssign={() => handleAssign(item)}
                onUnassign={() => handleUnassign(item)}
                onToggle={() => handleToggle(item)}
                onDelete={() => handleDelete(item)}
              />
            );
          }}
        />
      )}

      <CreateRiderSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
      />
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// RiderRow — one rider card with quick actions.
//
// Assignment state: when this rider is today's assigned rider
// (`is_assigned_today` set by the backend), the primary action swaps
// from "Assign today" to a "Remove" button so the super admin can clear
// the assignment without navigating anywhere. A green "Assigned today"
// chip appears in the header so the state is obvious at a glance from
// a scroll list of many riders.
// -----------------------------------------------------------------------------
function RiderRow({ rider, busy, onAssign, onUnassign, onToggle, onDelete }) {
  const status     = STATUS_TONE[rider.status] || STATUS_TONE.idle;
  const isAssigned = !!rider.is_assigned_today;
  return (
    <Card style={isAssigned ? styles.rowAssignedCard : undefined}>
      <View style={styles.rowHead}>
        <Avatar name={rider.name} size={40} />
        <View style={{ flex: 1 }}>
          <View style={styles.rowNameRow}>
            <Text style={styles.rowName}>{rider.name}</Text>
            {isAssigned && (
              <Chip
                label="Assigned today"
                tone="success"
                icon="checkmark-circle-outline"
              />
            )}
          </View>
          <Text style={styles.rowPhone}>{rider.phone}</Text>
        </View>
        {rider.is_active
          ? <Chip label={status.label} tone={status.tone} icon="radio-outline" />
          : <Chip label="Off duty" tone="neutral" icon="pause-circle-outline" />}
      </View>

      <View style={styles.rowMeta}>
        <MetaCell label="Zone" value={rider.zone?.name || 'All zones'} />
        <MetaCell label="Linked user" value={rider.user_id ? 'Yes' : 'No'} />
        {rider.current_address ? <MetaCell label="Last seen" value={rider.current_address} wide /> : null}
      </View>

      <View style={styles.rowActions}>
        {isAssigned ? (
          <Button
            label="Remove from run"
            onPress={onUnassign}
            size="sm"
            icon="close-circle-outline"
            disabled={busy}
            loading={busy}
            variant="secondary"
            style={{ flex: 1 }}
          />
        ) : (
          <Button
            label="Add to run"
            onPress={onAssign}
            size="sm"
            icon="add-circle-outline"
            disabled={!rider.is_active || busy}
            loading={busy}
            style={{ flex: 1 }}
          />
        )}
        <Button
          label={rider.is_active ? 'Deactivate' : 'Activate'}
          onPress={onToggle}
          size="sm"
          variant="secondary"
          icon={rider.is_active ? 'pause-outline' : 'play-outline'}
          disabled={busy}
          loading={busy}
          style={{ flex: 1 }}
        />
        <Pressable
          onPress={onDelete}
          disabled={busy}
          style={({ pressed }) => [styles.deleteBtn, pressed && { backgroundColor: colors.dangerSoft }]}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${rider.name}`}
        >
          <Ionicons name="trash-outline" size={18} color={busy ? colors.inkGhost : colors.danger} />
        </Pressable>
      </View>
    </Card>
  );
}

function MetaCell({ label, value, wide }) {
  return (
    <View style={[styles.metaCell, wide && { flexBasis: '100%' }]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// CreateRiderSheet — modal to create a standalone rider.
// (Promote-from-user mode is doable via the same endpoint but requires the
// user picker; standalone is the far more common admin flow, so this UI
// keeps it simple. To promote an existing user, use the Zone-admins screen
// pattern or extend this sheet later.)
// -----------------------------------------------------------------------------
function CreateRiderSheet({ visible, onClose, onCreated }) {
  const [name,         setName]         = useState('');
  const [phone,        setPhone]        = useState('');
  const [password,     setPassword]     = useState('');
  const [zoneId,       setZoneId]       = useState(null);
  const [zones,        setZones]        = useState([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [submitting,   setSubmitting]   = useState(false);

  // Reset fields whenever the sheet is opened afresh
  useEffect(() => {
    if (!visible) return;
    setName(''); setPhone(''); setPassword(''); setZoneId(null); setSubmitting(false);
  }, [visible]);

  // Lazy-load zones on first open
  useEffect(() => {
    if (!visible || zones.length > 0) return;
    (async () => {
      setZonesLoading(true);
      try {
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch { setZones([]); }
      finally  { setZonesLoading(false); }
    })();
  }, [visible, zones.length]);

  const canSubmit =
    name.trim().length >= 2 &&
    /^[6-9]\d{9}$/.test(phone) &&
    password.length >= 6 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await trackingApi.createRider({
        name:              name.trim(),
        phone:             phone.trim(),
        password,
        zone_location_id:  zoneId || undefined,
      });
      if (res.success) {
        Alert.alert('Rider created', `${res.data.name} can now log in as a rider.`);
        onCreated?.(res.data);
      }
    } catch (err) {
      Alert.alert("Couldn't create rider", err?.response?.data?.message || 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => (submitting ? null : onClose())}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalSheet}
        >
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Add rider</Text>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space[3] }}>
            <View>
              <Text style={styles.modalLabel}>Full name</Text>
              <Input value={name} onChangeText={setName} placeholder="Rider's name" autoCapitalize="words" maxLength={80} />
            </View>
            <View>
              <Text style={styles.modalLabel}>Phone (10 digits, starts 6–9)</Text>
              <Input
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/\D/g, ''))}
                placeholder="10-digit mobile number"
                keyboardType="phone-pad"
                maxLength={10}
                icon="call-outline"
              />
            </View>
            <View>
              <Text style={styles.modalLabel}>Password (min 6 chars)</Text>
              <PasswordInput
                value={password}
                onChangeText={setPassword}
                placeholder="Set a password"
              />
            </View>
            <View>
              <Text style={styles.modalLabel}>Zone <Text style={styles.modalOptional}>· optional (blank = all zones)</Text></Text>
              {zonesLoading ? (
                <LoadingState message="Loading zones…" compact />
              ) : (
                <View style={styles.zoneChips}>
                  <Chip
                    label="All zones"
                    tone={zoneId === null ? 'teal' : 'neutral'}
                    icon="globe-outline"
                    onPress={() => setZoneId(null)}
                    selected={zoneId === null}
                  />
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
            <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} disabled={submitting} />
            <Button
              label={submitting ? 'Creating…' : 'Create rider'}
              onPress={handleSubmit}
              loading={submitting}
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
  list:   { padding: space[4], paddingBottom: space[8] },

  rowHead:  { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowNameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  rowName:  { ...type.bodyStrong },
  rowPhone: { ...type.meta, marginTop: 2 },

  // Card gets a subtle green tint + border when this rider is the one
  // assigned for today. Deliberately understated — the "Assigned today"
  // chip carries the primary signal; this is peripheral reinforcement.
  rowAssignedCard: {
    borderColor: colors.success,
    borderWidth: 1,
    backgroundColor: colors.successSoft,
  },

  rowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[4],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  metaCell:  { minWidth: 96 },
  metaLabel: { ...type.micro, color: colors.inkFaint },
  metaValue: { ...type.bodyStrong, marginTop: 2 },

  rowActions: {
    flexDirection: 'row',
    gap: space[2],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
    alignItems: 'center',
  },
  deleteBtn: {
    width: 40, height: 40, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.ruleSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  // Modal
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
  modalTitle:   { ...type.h2, textAlign: 'center' },
  modalLabel:   { ...type.metaStrong, color: colors.inkMuted, marginBottom: space[2] },
  modalOptional:{ color: colors.inkFaint, fontWeight: '500' },
  zoneChips:    { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  modalActions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
});
