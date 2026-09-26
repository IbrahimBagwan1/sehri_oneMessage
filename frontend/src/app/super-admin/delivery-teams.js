import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  Modal,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trackingApi } from '../../api/tracking';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Super admin — Delivery teams.
//
// A team is one CAPTAIN, who drives and owns the route, plus zero or one
// HELPER, who rides along and hands parcels to people. The captain covers a
// set of zones; every PG in those zones is theirs for the whole run.
//
// This screen is the standing configuration, not a nightly chore. It is set
// up once and reused every night — the delivery run is generated from it on
// the Riders screen. What matters at 3am is reading it in one glance and
// changing one thing fast, so the layout is organised by ZONE COVERAGE
// rather than by rider:
//
//   • an uncovered-zone banner first, because a zone with no captain means
//     real people get no food and it is the only state that needs acting on
//     tonight
//   • one card per captain, each showing their zones and their helper
//   • the zone picker greys out and labels what another captain already
//     holds, so an overlap is visible before it is attempted rather than
//     explained by an error afterwards
//
// A zone can only have one captain — enforced by a unique index in the
// database, not just here. Two captains sharing a zone would mean two people
// riding to the same PG with the same packets while the resident tracks
// whichever one the query happened to return.
// -----------------------------------------------------------------------------

export default function DeliveryTeamsScreen() {
  const router = useRouter();

  const [roster, setRoster]         = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);

  const [zoneSheetFor, setZoneSheetFor]     = useState(null); // captain object
  const [helperSheetFor, setHelperSheetFor] = useState(null); // captain object

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await trackingApi.getTeamRoster();
      if (res.success) setRoster(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load the roster.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Every write returns the fresh roster, so there is no refetch round-trip
  // and no window where the screen shows the state before the change.
  const applyRoster = (res) => {
    if (res?.data?.roster) setRoster(res.data.roster);
    else load(true);
  };

  const captains = roster?.captains || [];
  const uncovered = roster?.uncovered_zones || [];
  const allZones = roster?.all_zones || [];

  // Riders who are neither a captain nor a helper — the pool this screen can
  // promote, and the only people eligible to be picked as a helper. Read
  // straight off `roster` so the memo has one stable dependency rather than
  // an array rebuilt on every render.
  const unrostered = useMemo(
    () => (roster?.available_riders || []).filter((r) => r.is_active),
    [roster]
  );

  const totalZones = allZones.length;
  const coveredZones = totalZones - uncovered.length;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Delivery teams" onBack={() => router.back()} />

      {loading ? (
        <LoadingState message="Loading roster…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={captains}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.teal]}
              tintColor={colors.teal}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          ListHeaderComponent={
            <CoverageHeader
              covered={coveredZones}
              total={totalZones}
              uncovered={uncovered}
            />
          }
          renderItem={({ item }) => (
            <CaptainCard
              captain={item}
              onEditZones={() => setZoneSheetFor(item)}
              onEditHelper={() => setHelperSheetFor(item)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="No captains yet"
              message="Pick a rider below and give them zones to make them a captain."
            />
          }
          ListFooterComponent={
            <UnrosteredSection
              riders={unrostered}
              onPromote={(rider) => setZoneSheetFor({ ...rider, zones: [], helper: null })}
            />
          }
        />
      )}

      <ZonePickerSheet
        captain={zoneSheetFor}
        allZones={allZones}
        onClose={() => setZoneSheetFor(null)}
        onSaved={(res) => { applyRoster(res); setZoneSheetFor(null); }}
      />
      <HelperPickerSheet
        captain={helperSheetFor}
        available={unrostered}
        onClose={() => setHelperSheetFor(null)}
        onSaved={(res) => { applyRoster(res); setHelperSheetFor(null); }}
      />
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// Coverage summary. The uncovered list is the one thing on this screen that
// can cost someone their food tonight, so it leads and it is loud.
// -----------------------------------------------------------------------------
function CoverageHeader({ covered, total, uncovered }) {
  const allCovered = uncovered.length === 0 && total > 0;
  return (
    <View style={{ marginBottom: space[4] }}>
      <View style={[styles.coverageBar, allCovered ? styles.coverageOk : styles.coverageWarn]}>
        <Ionicons
          name={allCovered ? 'checkmark-circle' : 'alert-circle'}
          size={20}
          color={allCovered ? colors.success : colors.warn}
        />
        <Text style={[styles.coverageText, { color: allCovered ? colors.success : colors.warn }]}>
          {total === 0
            ? 'No zones exist yet'
            : allCovered
              ? `All ${total} zones covered`
              : `${covered} of ${total} zones covered`}
        </Text>
      </View>

      {uncovered.length > 0 && (
        <View style={styles.uncoveredBox}>
          <Text style={styles.uncoveredTitle}>
            Nobody is delivering to {uncovered.length === 1 ? 'this zone' : 'these zones'}
          </Text>
          <View style={styles.zoneWrap}>
            {uncovered.map((z) => (
              <Chip key={z.id} label={z.name} tone="warn" />
            ))}
          </View>
          <Text style={styles.uncoveredHint}>
            Residents there will be reported as uncovered when you start tonight&apos;s run.
            Give the zone to a captain below.
          </Text>
        </View>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------------
// One captain, their zones, and their helper.
// -----------------------------------------------------------------------------
function CaptainCard({ captain, onEditZones, onEditHelper }) {
  const zones = captain.zones || [];
  const helper = captain.helper;

  return (
    <Card>
      <View style={styles.cardHead}>
        <Avatar name={captain.name} size={40} />
        <View style={{ flex: 1 }}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{captain.name}</Text>
            <Chip label="Captain" tone="teal" />
          </View>
          <Text style={styles.phone}>{captain.phone}</Text>
        </View>
        {!captain.is_active && <Chip label="Off duty" tone="neutral" />}
      </View>

      {/* --- zones ------------------------------------------------------ */}
      <Pressable
        onPress={onEditZones}
        style={({ pressed }) => [styles.section, pressed && styles.sectionPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Edit zones for ${captain.name}`}
      >
        <View style={styles.sectionHead}>
          <Ionicons name="map-outline" size={16} color={colors.inkFaint} />
          <Text style={styles.sectionLabel}>
            {zones.length === 0
              ? 'No zones'
              : `${zones.length} zone${zones.length === 1 ? '' : 's'}`}
          </Text>
          <View style={{ flex: 1 }} />
          <Ionicons name="chevron-forward" size={16} color={colors.inkGhost} />
        </View>
        {zones.length === 0 ? (
          <Text style={styles.sectionEmpty}>
            Tap to give them zones — without any, they have no route.
          </Text>
        ) : (
          <View style={styles.zoneWrap}>
            {zones.map((z) => <Chip key={z.id} label={z.name} tone="teal" />)}
          </View>
        )}
      </Pressable>

      {/* --- helper ----------------------------------------------------- */}
      <Pressable
        onPress={onEditHelper}
        style={({ pressed }) => [styles.section, pressed && styles.sectionPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Edit helper for ${captain.name}`}
      >
        <View style={styles.sectionHead}>
          <Ionicons name="person-add-outline" size={16} color={colors.inkFaint} />
          <Text style={styles.sectionLabel}>Helper</Text>
          <View style={{ flex: 1 }} />
          <Ionicons name="chevron-forward" size={16} color={colors.inkGhost} />
        </View>
        {helper ? (
          <View style={styles.helperRow}>
            <Avatar name={helper.name} size={28} />
            <Text style={styles.helperName}>{helper.name}</Text>
            <Chip label="Tracked" tone="gold" />
          </View>
        ) : (
          <Text style={styles.sectionEmpty}>
            Riding solo. Tap to add someone to hand out parcels.
          </Text>
        )}
      </Pressable>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Riders on nobody's team. Making one a captain is the same action as
// editing zones — give them a zone and they are one.
// -----------------------------------------------------------------------------
function UnrosteredSection({ riders, onPromote }) {
  if (riders.length === 0) return null;
  return (
    <View style={{ marginTop: space[6] }}>
      <SectionHeader title={`Not on a team · ${riders.length}`} />
      <Text style={styles.footHint}>
        Give someone a zone to make them a captain, or pick them as a helper from a
        captain&apos;s card above.
      </Text>
      {riders.map((r) => (
        <Pressable
          key={r.id}
          onPress={() => onPromote(r)}
          style={({ pressed }) => [styles.freeRow, pressed && styles.sectionPressed]}
        >
          <Avatar name={r.name} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={styles.freeName}>{r.name}</Text>
            <Text style={styles.phone}>{r.phone}</Text>
          </View>
          <Text style={styles.freeAction}>Give zones</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.inkGhost} />
        </Pressable>
      ))}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Zone picker.
//
// Every zone is listed, including the ones another captain holds. Those are
// shown disabled with the holder's name, so overlap is answered before it is
// attempted — an admin can see that Masjid is Rahil's without tapping it and
// reading an error. Selection is the whole set: what is ticked when you save
// is what the captain ends up with.
// -----------------------------------------------------------------------------
function ZonePickerSheet({ captain, allZones, onClose, onSaved }) {
  const [selected, setSelected] = useState(null); // null until opened
  const [saving, setSaving] = useState(false);

  // Derive the initial tick state from the captain being edited rather than
  // syncing it in an effect — an effect would fire a render late and briefly
  // show the previous captain's zones.
  const initial = useMemo(
    () => new Set((captain?.zones || []).map((z) => z.id)),
    [captain]
  );
  const current = selected ?? initial;

  const close = () => { setSelected(null); onClose(); };

  const toggle = (zoneId) => {
    const next = new Set(current);
    if (next.has(zoneId)) next.delete(zoneId); else next.add(zoneId);
    setSelected(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await trackingApi.setCaptainZones(captain.id, Array.from(current));
      setSelected(null);
      onSaved(res);
    } catch (err) {
      Alert.alert(
        "Couldn't save zones",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (!captain) return null;

  const mine = (z) => !z.captain_rider_id || z.captain_rider_id === captain.id;
  const holderName = (z) => {
    if (mine(z)) return null;
    return z.captain_name || 'another captain';
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Zones for {captain.name}</Text>
            <Pressable onPress={close} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.inkFaint} />
            </Pressable>
          </View>
          <Text style={styles.sheetHint}>
            Every PG in a zone you pick becomes this captain&apos;s for the whole run.
            A zone can only have one captain.
          </Text>

          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingVertical: space[2] }}>
            {allZones.length === 0 && (
              <Text style={styles.sectionEmpty}>No zones exist yet.</Text>
            )}
            {allZones.map((z) => {
              const taken = !mine(z);
              const on = current.has(z.id);
              return (
                <Pressable
                  key={z.id}
                  disabled={taken}
                  onPress={() => toggle(z.id)}
                  style={({ pressed }) => [
                    styles.zoneRow,
                    on && styles.zoneRowOn,
                    taken && styles.zoneRowTaken,
                    pressed && !taken && styles.sectionPressed,
                  ]}
                >
                  <Ionicons
                    name={
                      taken ? 'lock-closed-outline'
                        : on ? 'checkbox' : 'square-outline'
                    }
                    size={20}
                    color={taken ? colors.inkGhost : on ? colors.teal : colors.inkFaint}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.zoneName, taken && { color: colors.inkGhost }]}>
                      {z.name}
                    </Text>
                    {taken && (
                      <Text style={styles.zoneTakenBy}>
                        Already {holderName(z)}&apos;s — unassign it there first
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" onPress={close} style={{ flex: 1 }} />
            <Button
              label={saving ? 'Saving…' : `Save ${current.size} zone${current.size === 1 ? '' : 's'}`}
              onPress={save}
              disabled={saving}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Helper picker. One list, one tap, plus an explicit "runs solo" row so
// removing a helper is as easy as adding one.
// -----------------------------------------------------------------------------
function HelperPickerSheet({ captain, available, onClose, onSaved }) {
  const [busyId, setBusyId] = useState(null);
  if (!captain) return null;

  const pick = async (helperId) => {
    setBusyId(helperId || 'none');
    try {
      const res = await trackingApi.setCaptainHelper(captain.id, helperId);
      onSaved(res);
    } catch (err) {
      Alert.alert(
        "Couldn't update the helper",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const currentHelper = captain.helper;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Helper for {captain.name}</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.inkFaint} />
            </Pressable>
          </View>
          <Text style={styles.sheetHint}>
            A helper rides along on the same route and hands parcels to people. Their
            phone is the one residents follow, since the captain is driving.
          </Text>

          <ScrollView style={{ maxHeight: 340 }}>
            <Pressable
              onPress={() => pick(null)}
              disabled={busyId != null}
              style={({ pressed }) => [
                styles.helperOption,
                !currentHelper && styles.helperOptionOn,
                pressed && styles.sectionPressed,
              ]}
            >
              <Ionicons
                name={!currentHelper ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={!currentHelper ? colors.teal : colors.inkFaint}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.zoneName}>Runs solo</Text>
                <Text style={styles.zoneTakenBy}>No helper — the captain is tracked directly.</Text>
              </View>
              {busyId === 'none' && <ActivityIndicator size="small" color={colors.teal} />}
            </Pressable>

            {currentHelper && (
              <Pressable
                disabled
                style={[styles.helperOption, styles.helperOptionOn]}
              >
                <Ionicons name="radio-button-on" size={20} color={colors.teal} />
                <Avatar name={currentHelper.name} size={28} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneName}>{currentHelper.name}</Text>
                  <Text style={styles.zoneTakenBy}>Current helper</Text>
                </View>
              </Pressable>
            )}

            {available.length === 0 && !currentHelper && (
              <Text style={styles.sectionEmpty}>
                No free riders. Everyone is already a captain or somebody&apos;s helper.
              </Text>
            )}

            {available.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => pick(r.id)}
                disabled={busyId != null}
                style={({ pressed }) => [styles.helperOption, pressed && styles.sectionPressed]}
              >
                <Ionicons name="radio-button-off" size={20} color={colors.inkFaint} />
                <Avatar name={r.name} size={28} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneName}>{r.name}</Text>
                  <Text style={styles.zoneTakenBy}>{r.phone}</Text>
                </View>
                {busyId === r.id && <ActivityIndicator size="small" color={colors.teal} />}
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.sheetActions}>
            <Button label="Done" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  list:   { padding: space[4], paddingBottom: space[10] },

  coverageBar: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    paddingVertical: space[3], paddingHorizontal: space[4],
    borderRadius: radius.lg, borderWidth: 1,
  },
  coverageOk:   { backgroundColor: colors.successSoft, borderColor: colors.success },
  coverageWarn: { backgroundColor: colors.warnSoft,    borderColor: colors.warn },
  coverageText: { ...type.bodyStrong },

  uncoveredBox: {
    marginTop: space[3], padding: space[4],
    backgroundColor: colors.paper, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.ruleSoft,
  },
  uncoveredTitle: { ...type.bodyStrong, marginBottom: space[2] },
  uncoveredHint:  { ...type.meta, marginTop: space[2] },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  name:     { ...type.bodyStrong },
  phone:    { ...type.meta },

  section: {
    marginTop: space[3], paddingTop: space[3],
    borderTopWidth: 1, borderTopColor: colors.ruleFaint,
  },
  sectionPressed: { opacity: 0.6 },
  sectionHead:  { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[2] },
  sectionLabel: { ...type.metaStrong },
  sectionEmpty: { ...type.meta, fontStyle: 'italic' },

  zoneWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },

  helperRow:  { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  helperName: { ...type.body, color: colors.ink, flex: 1 },

  footHint: { ...type.meta, marginBottom: space[2] },
  freeRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    backgroundColor: colors.paper, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.ruleSoft,
    padding: space[3], marginBottom: space[2],
  },
  freeName:   { ...type.bodyStrong },
  freeAction: { ...type.meta, color: colors.teal, fontWeight: '700' },

  sheetBackdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: space[4], paddingBottom: space[6],
  },
  sheetHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...type.display, fontSize: 20, flex: 1 },
  sheetHint:  { ...type.meta, marginTop: space[1], marginBottom: space[2] },
  sheetActions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },

  zoneRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingVertical: space[3], paddingHorizontal: space[3],
    borderRadius: radius.md, marginBottom: space[1],
    borderWidth: 1, borderColor: 'transparent',
  },
  zoneRowOn:    { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  zoneRowTaken: { opacity: 0.6 },
  zoneName:     { ...type.body, color: colors.ink },
  zoneTakenBy:  { ...type.meta, fontSize: 12 },

  helperOption: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingVertical: space[3], paddingHorizontal: space[3],
    borderRadius: radius.md, marginBottom: space[1],
    borderWidth: 1, borderColor: 'transparent',
  },
  helperOptionOn: { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
});
