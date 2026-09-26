import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { locationsApi } from '../../api/auth';
import { locationsAdminApi } from '../../api/locations';
import {
  Button,
  Chip,
  ErrorState,
  Header,
  Input,
  LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Location tree — super admin only.
//
// Until now only PGs could be added (the "PG coordinates" screen); everything
// above them was seeded and could only be changed with a migration. This
// screen exposes the whole tree, so the community can actually grow:
//
//     City → Region → Area → Zone → PG
//
// Each level may only hang off the one above it. That rule lives on the
// server (locationController's HIERARCHY / PARENT_OF) and is mirrored here so
// the picker only ever offers valid parents, rather than letting someone
// build an invalid combination and then rejecting it.
//
// ADDING A ZONE IS THE SPECIAL ONE, and the screen says so before you commit:
// a zone gets a permanent key that every vote is filed under, and its group
// chat is created the moment it exists. Both are handled server-side.
// -----------------------------------------------------------------------------

const LEVELS = [
  { type: 'city',    label: 'City',   plural: 'Cities',  icon: 'business-outline',  parent: null },
  { type: 'region',  label: 'Region', plural: 'Regions', icon: 'map-outline',       parent: 'city' },
  { type: 'area',    label: 'Area',   plural: 'Areas',   icon: 'navigate-outline',  parent: 'region' },
  { type: 'zone',    label: 'Zone',   plural: 'Zones',   icon: 'flag-outline',      parent: 'area' },
  { type: 'address', label: 'PG',     plural: 'PGs',     icon: 'home-outline',      parent: 'zone' },
];

const LEVEL_BY_TYPE = Object.fromEntries(LEVELS.map((l) => [l.type, l]));

export default function LocationTreeScreen() {
  const router = useRouter();

  const [byType,     setByType]     = useState({});
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [openType,   setOpenType]   = useState('zone');   // zones are the interesting level
  const [formOpen,   setFormOpen]   = useState(false);
  const [formType,   setFormType]   = useState('zone');
  const [busyId,     setBusyId]     = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      // One request per level rather than a tree endpoint: the list endpoint
      // already exists and is public, and the whole table is a few dozen rows.
      const results = await Promise.all(
        LEVELS.map((l) => locationsApi.getLocations({ type: l.type }))
      );
      const next = {};
      LEVELS.forEach((l, i) => {
        next[l.type] = results[i]?.data || [];
      });
      setByType(next);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load locations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const nameOf = (id) => {
    for (const l of LEVELS) {
      const hit = (byType[l.type] || []).find((r) => r.id === id);
      if (hit) return hit.name;
    }
    return null;
  };

  const handleDelete = (row) => {
    const level = LEVEL_BY_TYPE[row.type];
    const isZone = row.type === 'zone';
    Alert.alert(
      `Remove ${row.name}?`,
      isZone
        ? 'Its group chat closes too. Past votes from this zone are kept — they '
          + 'are filed under the zone key, not the name. This cannot be undone '
          + 'from the app.'
        : `The ${level.label.toLowerCase()} is hidden everywhere in the app. `
          + 'Anything still underneath it has to be moved or removed first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyId(row.id);
            try {
              const res = await locationsAdminApi.deleteAddress(row.id);
              await load();
              Alert.alert('Removed', res.message);
            } catch (err) {
              // 409 here is the server refusing because children or residents
              // remain — that message is the useful part, so show it as-is.
              Alert.alert("Couldn't remove", err?.response?.data?.message || 'Try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const openAdd = (type) => {
    setFormType(type);
    setFormOpen(true);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Locations" onBack={() => router.back()} />
        <LoadingState message="Loading the location tree…" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Locations" onBack={() => router.back()} />
        <ErrorState message={error} onRetry={() => load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Locations" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />
        }
      >
        <Text style={styles.intro}>
          The community is organised as City → Region → Area → Zone → PG. Each level
          sits inside the one before it.
        </Text>

        {LEVELS.map((level) => {
          const rows = byType[level.type] || [];
          const open = openType === level.type;
          const parentLevel = level.parent ? LEVEL_BY_TYPE[level.parent] : null;
          const canAdd = !parentLevel || (byType[level.parent] || []).length > 0;

          return (
            <View key={level.type} style={styles.levelBlock}>
              <Pressable
                onPress={() => setOpenType(open ? null : level.type)}
                style={({ pressed }) => [styles.levelHead, pressed && styles.levelHeadPressed]}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${level.plural}, ${rows.length}`}
              >
                <View style={styles.levelIcon}>
                  <Ionicons name={level.icon} size={18} color={colors.tealDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.levelTitle}>{level.plural}</Text>
                  <Text style={styles.levelCount}>
                    {rows.length} {rows.length === 1 ? level.label.toLowerCase() : level.plural.toLowerCase()}
                    {level.type === 'zone' && rows.length > 0 ? ' · one group chat each' : ''}
                  </Text>
                </View>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.inkFaint}
                />
              </Pressable>

              {open ? (
                <View style={styles.levelBody}>
                  {rows.length === 0 ? (
                    <Text style={styles.empty}>
                      No {level.plural.toLowerCase()} yet.
                      {parentLevel && !canAdd
                        ? ` Add ${parentLevel.plural.toLowerCase() === 'cities' ? 'a city' : `a ${parentLevel.label.toLowerCase()}`} first.`
                        : ''}
                    </Text>
                  ) : (
                    rows.map((row) => (
                      <View key={row.id} style={styles.row}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowName} numberOfLines={1}>{row.name}</Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {parentLevel
                              ? `in ${nameOf(row.parent_id) || '—'}`
                              : 'top level'}
                            {row.zone_key ? ` · key ${row.zone_key}` : ''}
                          </Text>
                        </View>
                        {row.latitude != null ? (
                          <Ionicons name="location" size={15} color={colors.teal} />
                        ) : null}
                        <Pressable
                          onPress={() => handleDelete(row)}
                          hitSlop={8}
                          style={styles.rowBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${row.name}`}
                        >
                          {busyId === row.id
                            ? <ActivityIndicator size="small" color={colors.danger} />
                            : <Ionicons name="trash-outline" size={17} color={colors.danger} />}
                        </Pressable>
                      </View>
                    ))
                  )}

                  <Pressable
                    onPress={() => canAdd && openAdd(level.type)}
                    disabled={!canAdd}
                    style={({ pressed }) => [
                      styles.addRow,
                      !canAdd && styles.addRowDisabled,
                      pressed && canAdd && styles.addRowPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canAdd }}
                    accessibilityLabel={`Add a ${level.label.toLowerCase()}`}
                  >
                    <Ionicons name="add-circle-outline" size={17} color={canAdd ? colors.teal : colors.inkGhost} />
                    <Text style={[styles.addText, !canAdd && { color: colors.inkGhost }]}>
                      Add a {level.label.toLowerCase()}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}

        <Text style={styles.footnote}>
          To drop or move a map pin on a PG, use PG coordinates.
        </Text>
      </ScrollView>

      <LocationFormSheet
        visible={formOpen}
        type={formType}
        parents={byType[LEVEL_BY_TYPE[formType]?.parent] || []}
        onClose={() => setFormOpen(false)}
        onSaved={async (data, message) => {
          setFormOpen(false);
          await load();
          setOpenType(formType);
          Alert.alert(
            `${LEVEL_BY_TYPE[formType].label} added`,
            message || `${data?.name} was created.`
          );
        }}
      />
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// LocationFormSheet — name + parent, with the parent list constrained to the
// one level that is actually allowed to hold this type.
// -----------------------------------------------------------------------------
function LocationFormSheet({ visible, type, parents, onClose, onSaved }) {
  const level = LEVEL_BY_TYPE[type] || LEVEL_BY_TYPE.zone;
  const parentLevel = level.parent ? LEVEL_BY_TYPE[level.parent] : null;

  const [name,     setName]     = useState('');
  const [parentId, setParentId] = useState(null);
  const [saving,   setSaving]   = useState(false);

  // Keyed on `visible` + `type` so the fields reset each time it opens
  // rather than carrying the previous level's input across.
  const [seedKey, setSeedKey] = useState('');
  const key = `${visible}:${type}`;
  if (key !== seedKey) {
    setSeedKey(key);
    if (name !== '') setName('');
    if (parentId !== null) setParentId(null);
    if (saving) setSaving(false);
  }

  const trimmed = name.trim();
  const canSubmit =
    trimmed.length >= 2
    && trimmed.length <= 150
    && (!parentLevel || !!parentId)
    && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await locationsAdminApi.createLocation({
        name: trimmed,
        type,
        parent_id: parentId || undefined,
      });
      if (res.success) onSaved?.(res.data, res.message);
    } catch (err) {
      Alert.alert(
        `Couldn't add the ${level.label.toLowerCase()}`,
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => (saving ? null : onClose())}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheet}
        >
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Add a {level.label.toLowerCase()}</Text>

          {type === 'zone' ? (
            <View style={styles.zoneNotice}>
              <Ionicons name="information-circle-outline" size={16} color={colors.tealDark} />
              <Text style={styles.zoneNoticeText}>
                A new zone gets its own group chat straight away, and every member who
                registers there joins it automatically. Its name can be changed later
                without affecting past votes.
              </Text>
            </View>
          ) : null}

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space[3] }}>
            <View>
              <Text style={styles.formLabel}>{level.label} name</Text>
              <Input
                value={name}
                onChangeText={setName}
                placeholder={
                  type === 'zone' ? 'e.g. Ladies Hostel'
                    : type === 'address' ? 'e.g. Rehmat PG'
                      : `e.g. ${level.label} name`
                }
                autoCapitalize="words"
                maxLength={150}
                icon={level.icon}
              />
            </View>

            {parentLevel ? (
              <View>
                <Text style={styles.formLabel}>{parentLevel.label}</Text>
                {parents.length === 0 ? (
                  <Text style={styles.formEmpty}>
                    No {parentLevel.plural.toLowerCase()} to put it in — add one first.
                  </Text>
                ) : (
                  <View style={styles.parentChips}>
                    {parents.map((p) => (
                      <Chip
                        key={p.id}
                        label={p.name}
                        tone={parentId === p.id ? 'teal' : 'neutral'}
                        selected={parentId === p.id}
                        onPress={() => setParentId(p.id)}
                      />
                    ))}
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={saving} style={{ flex: 1 }} />
            <Button
              label={saving ? 'Adding…' : `Add ${level.label.toLowerCase()}`}
              onPress={handleSubmit}
              disabled={!canSubmit}
              loading={saving}
              style={{ flex: 1 }}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { padding: space[4], paddingBottom: space[10] },

  intro: { ...type.meta, color: colors.inkMuted, lineHeight: 19, marginBottom: space[4] },
  footnote: { ...type.micro, color: colors.inkFaint, marginTop: space[4], textAlign: 'center' },

  levelBlock: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    marginBottom: space[3],
    overflow: 'hidden',
  },
  levelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
  },
  levelHeadPressed: { backgroundColor: colors.paperSoft },
  levelIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  levelTitle: { ...type.bodyStrong, color: colors.ink },
  levelCount: { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  levelBody: {
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
    paddingHorizontal: space[4],
    paddingBottom: space[3],
  },
  empty: { ...type.meta, color: colors.inkFaint, fontStyle: 'italic', paddingVertical: space[3] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleFaint,
  },
  rowName: { ...type.body, color: colors.ink, fontWeight: '600' },
  rowMeta: { ...type.micro, color: colors.inkFaint, marginTop: 2 },
  rowBtn:  { padding: 2 },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: space[3],
    marginTop: space[1],
  },
  addRowPressed:  { opacity: 0.6 },
  addRowDisabled: { opacity: 0.5 },
  addText: { ...type.metaStrong, color: colors.teal },

  // ---- form sheet ----
  overlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[5],
    paddingTop: space[3],
    paddingBottom: space[5],
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[3],
  },
  sheetTitle: { ...type.h2, color: colors.ink, marginBottom: space[3] },

  zoneNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    marginBottom: space[4],
  },
  zoneNoticeText: { ...type.micro, color: colors.tealDark, flex: 1, lineHeight: 16 },

  formLabel: { ...type.metaStrong, marginBottom: 6 },
  formEmpty: { ...type.meta, color: colors.inkFaint, fontStyle: 'italic' },
  parentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },

  sheetActions: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
});
