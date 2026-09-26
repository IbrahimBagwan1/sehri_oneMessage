import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  Modal,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { chatApi } from '../api/chat';
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
  SectionHeader,
} from '../components/ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// Manage a chat group — super admin only.
//
// Two things live on this screen, and the distinction between them is the
// whole point:
//
//   ZONES      Which zones the group covers. Everyone in a covered zone — its
//              approved members, its zone admins — is pulled in automatically
//              and kept in sync as people join, move and leave. Super admins
//              are in every zone-backed group by definition.
//
//   MEMBERS    Who is actually in the room. Rows the zones put there are
//              marked "Automatic" and cannot be removed by hand: the server
//              refuses, because the next reconcile would only put them back.
//              Rows a super admin added deliberately are marked "Added" and
//              can be removed.
//
// So the way to change who is in a zone chat is to change the zones, or to
// change the person's zone or role — not to pick names off a list. The copy
// on this screen says that, rather than letting someone discover it from a
// failed tap.
// -----------------------------------------------------------------------------

const ROLE_LABEL = {
  user:        'Member',
  admin:       'Zone admin',
  super_admin: 'Super admin',
};

export default function ChatGroupManageScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const groupId = typeof params.id === 'string' ? params.id : '';

  const [group,      setGroup]      = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [busy,       setBusy]       = useState(null);   // id of whatever is mid-flight

  // Zone-picker state lives here rather than in the sheet so the fetch hangs
  // off the tap that opens it. Loading on an event beats loading in a
  // visibility effect: no cascading render, and the counts are always fresh
  // because opening the picker IS the refresh.
  const [zonePickerOpen, setZonePickerOpen] = useState(false);
  const [zoneOptions,    setZoneOptions]    = useState([]);
  const [zonesLoading,   setZonesLoading]   = useState(false);
  const [zonesError,     setZonesError]     = useState(null);

  const loadZoneOptions = useCallback(async () => {
    setZonesLoading(true);
    setZonesError(null);
    try {
      const res = await chatApi.listZones(groupId);
      if (res.success) setZoneOptions(res.data.zones || []);
    } catch (err) {
      setZonesError(err?.response?.data?.message || "Couldn't load zones.");
    } finally {
      setZonesLoading(false);
    }
  }, [groupId]);

  const openZonePicker = useCallback(() => {
    setZonePickerOpen(true);
    loadZoneOptions();
  }, [loadZoneOptions]);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await chatApi.getGroup(groupId);
      if (res.success) setGroup(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load this group.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Automatic members first — they are the group's backbone, and grouping
  // them keeps the "Added" ones visually separable from the crowd.
  const members = useMemo(() => {
    const rows = group?.members || [];
    return [...rows].sort((a, b) => {
      if (a.source !== b.source) return a.source === 'auto' ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [group]);

  const autoCount   = members.filter((m) => m.source === 'auto').length;
  const manualCount = members.length - autoCount;

  const handleAddZone = async (zone) => {
    setBusy(zone.id);
    try {
      const res = await chatApi.addZone(groupId, zone.id);
      setZonePickerOpen(false);
      await load();
      Alert.alert('Zone added', res.message);
    } catch (err) {
      Alert.alert("Couldn't add that zone", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveZone = (zone) => {
    Alert.alert(
      `Remove ${zone.name}?`,
      `Members of ${zone.name} will leave this group unless another of its zones still covers them. `
      + 'Anyone added by hand stays.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(zone.id);
            try {
              const res = await chatApi.removeZone(groupId, zone.id);
              await load();
              Alert.alert('Zone removed', res.message);
            } catch (err) {
              Alert.alert("Couldn't remove that zone", err?.response?.data?.message || 'Try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const handleRemoveMember = (member) => {
    Alert.alert(
      `Remove ${member.name}?`,
      'They will lose access to this conversation. You can add them back at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(member.user_id);
            try {
              await chatApi.removeMember(groupId, member.user_id, member.user_type);
              await load();
            } catch (err) {
              Alert.alert("Couldn't remove", err?.response?.data?.message || 'Try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Group settings" onBack={() => router.back()} />
        <LoadingState message="Loading group…" />
      </SafeAreaView>
    );
  }

  if (error || !group) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Group settings" onBack={() => router.back()} />
        <ErrorState message={error || 'Group not found.'} onRetry={() => load()} />
      </SafeAreaView>
    );
  }

  const zones = group.zones || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title={group.name} onBack={() => router.back()} />

      <FlatList
        data={members}
        keyExtractor={(m) => `${m.user_type}:${m.user_id}`}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />
        }
        ListHeaderComponent={
          <View>
            {group.is_default ? (
              <View style={styles.noticeCard}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.tealDark} />
                <Text style={styles.noticeText}>
                  This is {zones[0]?.name || 'a zone'}&apos;s own group. Everyone in the zone is a
                  member automatically, so it can&apos;t be deleted.
                </Text>
              </View>
            ) : null}

            {group.description ? (
              <Text style={styles.description}>{group.description}</Text>
            ) : null}

            {/* ---- Zones ---- */}
            <SectionHeader
              title="Zones covered"
              subtitle="Everyone in these zones is in the group automatically"
              style={styles.sectionHead}
            />
            <View style={styles.zoneWrap}>
              {zones.map((z) => (
                <Pressable
                  key={z.id}
                  onPress={() => handleRemoveZone(z)}
                  disabled={busy === z.id}
                  style={({ pressed }) => [styles.zoneChip, pressed && styles.zoneChipPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${z.name}. Tap to stop covering this zone.`}
                >
                  <Ionicons name="location-outline" size={14} color={colors.tealDark} />
                  <Text style={styles.zoneChipText}>{z.name}</Text>
                  {busy === z.id
                    ? <ActivityIndicator size="small" color={colors.tealDark} />
                    : <Ionicons name="close" size={14} color={colors.tealDark} />}
                </Pressable>
              ))}

              <Pressable
                onPress={openZonePicker}
                style={({ pressed }) => [styles.addZoneChip, pressed && styles.zoneChipPressed]}
                accessibilityRole="button"
                accessibilityLabel="Add a zone to this group"
              >
                <Ionicons name="add" size={15} color={colors.tealDark} />
                <Text style={styles.zoneChipText}>Add zone</Text>
              </Pressable>
            </View>

            {zones.length === 0 ? (
              <Text style={styles.hint}>
                No zones yet — this group only has the people you add by hand. Add a zone to pull
                its members in and keep them in sync.
              </Text>
            ) : null}

            {/* ---- Members ---- */}
            <SectionHeader
              title="Members"
              subtitle={
                manualCount
                  ? `${autoCount} automatic · ${manualCount} added by hand`
                  : `${autoCount} automatic`
              }
              style={styles.sectionHead}
            />
          </View>
        }
        renderItem={({ item }) => {
          const isAuto = item.source === 'auto';
          return (
            <View style={styles.memberRow}>
              <Avatar name={item.name} size={36} />
              <View style={{ flex: 1, marginLeft: space[3] }}>
                <Text style={styles.memberName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.memberMeta} numberOfLines={1}>
                  {ROLE_LABEL[item.user_type] || item.user_type}
                  {item.phone ? ` · ${item.phone}` : ''}
                </Text>
              </View>
              <Chip
                label={isAuto ? 'Automatic' : 'Added'}
                tone={isAuto ? 'teal' : 'neutral'}
              />
              {isAuto ? null : (
                <Pressable
                  onPress={() => handleRemoveMember(item)}
                  hitSlop={8}
                  style={styles.removeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name}`}
                >
                  {busy === item.user_id
                    ? <ActivityIndicator size="small" color={colors.danger} />
                    : <Ionicons name="close-circle-outline" size={20} color={colors.danger} />}
                </Pressable>
              )}
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="Nobody here yet"
            message="Add a zone to bring its members in, or add people individually."
          />
        }
      />

      <ZonePickerSheet
        visible={zonePickerOpen}
        zones={zoneOptions}
        loading={zonesLoading}
        error={zonesError}
        busyId={busy}
        onRetry={loadZoneOptions}
        onClose={() => setZonePickerOpen(false)}
        onPick={handleAddZone}
      />
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// ZonePickerSheet — every active zone, with how many members it would bring.
// Zones already covered are shown but disabled, so the list reads as the
// complete picture rather than silently hiding what is already done.
// -----------------------------------------------------------------------------
function ZonePickerSheet({ visible, zones, loading, error, busyId, onRetry, onClose, onPick }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => { /* absorb */ }}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Add a zone</Text>
          <Text style={styles.sheetSubtitle}>
            Everyone in the zone joins straight away, and new members join as they&apos;re approved.
          </Text>

          {loading ? (
            <LoadingState message="Loading zones…" compact />
          ) : error ? (
            <ErrorState message={error} onRetry={onRetry} />
          ) : (
            <View style={styles.sheetList}>
              {zones.map((z) => (
                <Pressable
                  key={z.id}
                  onPress={() => !z.already_linked && onPick(z)}
                  disabled={z.already_linked || !!busyId}
                  style={({ pressed }) => [
                    styles.zoneOption,
                    z.already_linked && styles.zoneOptionDone,
                    pressed && !z.already_linked && styles.zoneOptionPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: z.already_linked }}
                  accessibilityLabel={
                    `${z.name}, ${z.member_count} members`
                    + (z.already_linked ? ', already covered' : '')
                  }
                >
                  <View style={styles.zoneOptionIcon}>
                    <Ionicons name="location-outline" size={18} color={colors.tealDark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.zoneOptionName}>{z.name}</Text>
                    <Text style={styles.zoneOptionMeta}>
                      {z.member_count} {z.member_count === 1 ? 'member' : 'members'}
                    </Text>
                  </View>
                  {busyId === z.id ? (
                    <ActivityIndicator size="small" color={colors.teal} />
                  ) : z.already_linked ? (
                    <Text style={styles.zoneOptionDoneText}>Covered</Text>
                  ) : (
                    <Ionicons name="add-circle-outline" size={20} color={colors.teal} />
                  )}
                </Pressable>
              ))}
            </View>
          )}

          <Button label="Close" variant="secondary" onPress={onClose} fullWidth style={{ marginTop: space[3] }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  list:   { paddingBottom: space[10] },

  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    margin: space[4],
    marginBottom: 0,
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  noticeText: { ...type.meta, color: colors.tealDark, flex: 1, lineHeight: 18 },

  description: {
    ...type.meta,
    color: colors.inkMuted,
    paddingHorizontal: space[4],
    paddingTop: space[4],
    lineHeight: 19,
  },

  sectionHead: { paddingHorizontal: space[4], paddingTop: space[5] },

  zoneWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    paddingHorizontal: space[4],
  },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space[3],
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  addZoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space[3],
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.teal,
    borderStyle: 'dashed',
  },
  zoneChipPressed: { backgroundColor: colors.tealBorder },
  zoneChipText:    { ...type.metaStrong, color: colors.tealDark },

  hint: {
    ...type.micro,
    color: colors.inkFaint,
    paddingHorizontal: space[4],
    paddingTop: space[2],
    lineHeight: 16,
  },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: colors.paper,
  },
  memberName: { ...type.bodyStrong, color: colors.ink },
  memberMeta: { ...type.micro, color: colors.inkFaint, marginTop: 2 },
  removeBtn:  { padding: 2 },
  separator:  { height: 1, backgroundColor: colors.ruleFaint, marginLeft: space[4] + 36 + space[3] },

  // ---- Zone picker sheet ----
  overlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[5],
    paddingTop: space[3],
    paddingBottom: space[5],
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[3],
  },
  sheetTitle:    { ...type.h2, color: colors.ink },
  sheetSubtitle: { ...type.meta, color: colors.inkMuted, marginTop: 3, marginBottom: space[4], lineHeight: 18 },
  sheetList:     { gap: space[2] },

  zoneOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
  },
  zoneOptionPressed: { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  zoneOptionDone:    { opacity: 0.55 },
  zoneOptionIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  zoneOptionName:     { ...type.bodyStrong, color: colors.ink },
  zoneOptionMeta:     { ...type.micro, color: colors.inkFaint, marginTop: 2 },
  zoneOptionDoneText: { ...type.micro, color: colors.inkFaint, fontWeight: '700' },
});
