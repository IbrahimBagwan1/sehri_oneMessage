import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { chatApi } from '../api/chat';
import { adminApi } from '../api/admin';
import { useAuthStore } from '../store/useAuthStore';
import {
  Avatar,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  SectionHeader,
  KeyboardAvoidingView
} from '../components/ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// Super-admin only — create a new chat group.
//
// Compose card: name + optional description.
// Members: segmented picker with two lists — Admins and Approved users.
// Selections persist across tab switches. A selection summary shows above
// the create button so the super-admin can see who they're about to add.
//
// The current super-admin is added by the backend automatically as the
// group's creator (see chatController.createGroup) — no need to pick self.
// -----------------------------------------------------------------------------

export default function ChatCreateGroupScreen() {
  const router      = useRouter();
  const active_role = useAuthStore((s) => s.active_role);

  // Route protection — super-admin only. Rendered as a friendly
  // ErrorState in the same shell, not a hard boot back.
  if (active_role !== 'super_admin') {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Create group" onBack={() => router.back()} />
        <ErrorState
          message="Only the super admin can create chat groups."
          onRetry={() => router.back()}
          retryLabel="Go back"
        />
      </SafeAreaView>
    );
  }
  return <ChatCreateGroupInner router={router} />;
}

function ChatCreateGroupInner({ router }) {
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [tab,         setTab]         = useState('admins');  // 'admins' | 'users'

  const [admins, setAdmins]       = useState([]);
  const [users,  setUsers]        = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error,   setError]       = useState(null);
  const [creating, setCreating]   = useState(false);

  // Selection state: keep two maps keyed by id → row, so we always have
  // enough info to render the "selected" chips without a second lookup.
  const [selectedAdmins, setSelectedAdmins] = useState({});
  const [selectedUsers,  setSelectedUsers]  = useState({});
  // Zones the new group should cover. Picking one makes the group behave
  // like a zone's own chat: everyone in it joins now and new members join
  // as they are approved, without anyone maintaining a list.
  const [zones,         setZones]         = useState([]);
  const [selectedZones, setSelectedZones] = useState({});

  // --- Load pickers -------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [adminRes, userRes, zoneRes] = await Promise.all([
        chatApi.listAdminsForPicker(),
        adminApi.getUsers('approved'),
        chatApi.listZones(),
      ]);
      setAdmins(adminRes?.data?.admins || []);
      // adminApi.getUsers returns { success, data: User[] } directly
      setUsers(Array.isArray(userRes?.data) ? userRes.data : []);
      setZones(zoneRes?.data?.zones || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load the member list.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // --- Selection ---------------------------------------------------------
  const toggleAdmin = (a) => {
    setSelectedAdmins((prev) => {
      const next = { ...prev };
      if (next[a.id]) delete next[a.id]; else next[a.id] = a;
      return next;
    });
  };
  const toggleUser = (u) => {
    setSelectedUsers((prev) => {
      const next = { ...prev };
      if (next[u.id]) delete next[u.id]; else next[u.id] = u;
      return next;
    });
  };

  const toggleZone = (z) => {
    setSelectedZones((prev) => {
      const next = { ...prev };
      if (next[z.id]) delete next[z.id]; else next[z.id] = z;
      return next;
    });
  };

  const selectedZoneList  = Object.values(selectedZones);
  const selectedAdminList = Object.values(selectedAdmins);
  const selectedUserList  = Object.values(selectedUsers);
  const totalSelected     = selectedAdminList.length + selectedUserList.length;

  // --- Create ------------------------------------------------------------
  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Group name', 'Please give this group a name.');
      return;
    }
    if (trimmed.length < 3) {
      Alert.alert('Group name', 'Use at least 3 characters so members can recognise it.');
      return;
    }
    const member_ids = [
      ...selectedAdminList.map((a) => ({ user_id: a.id, user_type: 'admin' })),
      ...selectedUserList.map((u)  => ({ user_id: u.id, user_type: 'user'  })),
    ];

    setCreating(true);
    try {
      const res = await chatApi.createGroup({
        name: trimmed,
        description: description.trim() || undefined,
        member_ids,
        zone_location_ids: selectedZoneList.map((z) => z.id),
      });
      if (res.success) {
        // Route replace → the new group screen. Back from the room lands
        // on the chat list, not this create form.
        router.replace({
          pathname: '/chat-room',
          params: { id: res.data.id, name: res.data.name },
        });
      }
    } catch (err) {
      Alert.alert("Couldn't create group", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setCreating(false);
    }
  };

  // --- Row renderers -----------------------------------------------------
  const renderAdmin = ({ item }) => {
    const on = Boolean(selectedAdmins[item.id]);
    return (
      <PickerRow
        selected={on}
        onPress={() => toggleAdmin(item)}
        name={item.name}
        subtitle={item.phone}
        badge={{ label: 'Admin', tone: 'gold' }}
      />
    );
  };
  const renderUser = ({ item }) => {
    const on = Boolean(selectedUsers[item.id]);
    return (
      <PickerRow
        selected={on}
        onPress={() => toggleUser(item)}
        name={item.name}
        subtitle={item.phone}
        // Zone name is on item.zone_location?.location_name when populated
        badge={
          item.zone_location?.location_name
            ? { label: item.zone_location.location_name, tone: 'teal' }
            : null
        }
      />
    );
  };

  const currentList  = tab === 'admins' ? admins : users;
  const currentRender = tab === 'admins' ? renderAdmin : renderUser;
  const currentEmpty  = tab === 'admins'
    ? { icon: 'shield-outline',    title: 'No zone admins',   msg: 'Add zone admins first, then group them here.' }
    : { icon: 'person-outline',    title: 'No approved users', msg: 'Only approved users appear in the picker.' };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header
        title="Create group"
        onBack={() => router.back()}
      />

      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
      >
        <FlatList
          data={loading || error ? [] : currentList}
          keyExtractor={(x) => x.id}
          renderItem={currentRender}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.headerBlock}>
              {/* Compose card */}
              <View style={styles.composeCard}>
                <Text style={styles.fieldLabel}>Group name</Text>
                <Input
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Zone captains, PG-3 residents"
                  autoCapitalize="sentences"
                  maxLength={80}
                />
                <View style={{ height: space[3] }} />
                <Text style={styles.fieldLabel}>Description <Text style={styles.optional}>· optional</Text></Text>
                <Input
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What is this group for?"
                  autoCapitalize="sentences"
                  multiline
                  maxLength={240}
                />
              </View>

              {/* Selected summary — always visible so counts are legible. */}
              <View style={styles.summaryCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryLabel}>Members</Text>
                  <Text style={styles.summaryCount}>
                    {totalSelected === 0
                      ? 'None selected yet'
                      : `${totalSelected} selected — ${selectedAdminList.length} admin${selectedAdminList.length === 1 ? '' : 's'}, ${selectedUserList.length} user${selectedUserList.length === 1 ? '' : 's'}`}
                  </Text>
                </View>
                {totalSelected > 0 && (
                  <Pressable
                    onPress={() => { setSelectedAdmins({}); setSelectedUsers({}); }}
                    hitSlop={8}
                    accessibilityLabel="Clear selection"
                  >
                    <Text style={styles.clearLink}>Clear</Text>
                  </Pressable>
                )}
              </View>

              {/* Selection chips overflow row */}
              {totalSelected > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipsRow}
                >
                  {selectedAdminList.map((a) => (
                    <Chip
                      key={`a-${a.id}`}
                      label={a.name}
                      tone="gold"
                      icon="shield-outline"
                      onPress={() => toggleAdmin(a)}
                    />
                  ))}
                  {selectedUserList.map((u) => (
                    <Chip
                      key={`u-${u.id}`}
                      label={u.name}
                      tone="teal"
                      icon="person-outline"
                      onPress={() => toggleUser(u)}
                    />
                  ))}
                </ScrollView>
              )}

              {/* Zones first: choosing one is usually the whole job, and
                  doing it before the name-by-name picker stops a super
                  admin hand-picking people a zone would have added anyway. */}
              <SectionHeader
                title="Cover a zone"
                subtitle="Its members and admins join automatically, now and in future"
              />
              {zones.length === 0 ? (
                <Text style={styles.zoneEmpty}>No zones set up yet.</Text>
              ) : (
                <View style={styles.zoneWrap}>
                  {zones.map((z) => {
                    const on = !!selectedZones[z.id];
                    return (
                      <Pressable
                        key={z.id}
                        onPress={() => toggleZone(z)}
                        style={({ pressed }) => [
                          styles.zoneChip,
                          on && styles.zoneChipOn,
                          pressed && !on && { backgroundColor: colors.paperSoft },
                        ]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${z.name}, ${z.member_count} members${on ? ', selected' : ''}`}
                      >
                        <Ionicons
                          name={on ? 'checkmark-circle' : 'location-outline'}
                          size={15}
                          color={on ? colors.paper : colors.tealDark}
                        />
                        <Text style={[styles.zoneChipText, on && styles.zoneChipTextOn]}>
                          {z.name}
                        </Text>
                        <Text style={[styles.zoneChipCount, on && styles.zoneChipTextOn]}>
                          {z.member_count}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <SectionHeader
                title="Add members"
                subtitle={
                  selectedZoneList.length
                    ? 'Anyone outside the zones above'
                    : undefined
                }
              />

              {/* Segmented control — admins / users */}
              <View style={styles.segment}>
                <SegBtn
                  active={tab === 'admins'}
                  label={`Admins${admins.length ? `  ${admins.length}` : ''}`}
                  onPress={() => setTab('admins')}
                />
                <SegBtn
                  active={tab === 'users'}
                  label={`Users${users.length ? `  ${users.length}` : ''}`}
                  onPress={() => setTab('users')}
                />
              </View>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <LoadingState message="Loading members…" />
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : (
              <EmptyState icon={currentEmpty.icon} title={currentEmpty.title} message={currentEmpty.msg} />
            )
          }
          contentContainerStyle={styles.list}
        />

        {/* Sticky create bar */}
        <View style={styles.footer}>
          <Button
            label={creating ? 'Creating…' : 'Create group'}
            icon="checkmark"
            onPress={handleCreate}
            loading={creating}
            disabled={!name.trim() || creating}
            fullWidth
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

function SegBtn({ active, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segBtn, active && styles.segBtnActive]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.segBtnText, active && styles.segBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PickerRow({ selected, onPress, name, subtitle, badge }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pickerRow,
        selected && styles.pickerRowSelected,
        pressed && !selected && { backgroundColor: colors.paperSoft },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${name}${selected ? ', selected' : ''}`}
    >
      <Avatar name={name} size={36} />
      <View style={{ flex: 1, marginLeft: space[3] }}>
        <View style={styles.rowTitleRow}>
          <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
          {badge && (
            <Chip label={badge.label} tone={badge.tone} style={{ marginLeft: space[2] }} />
          )}
        </View>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Ionicons name="checkmark" size={16} color={colors.paper} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  list: { paddingBottom: space[8] * 2 },

  headerBlock: { padding: space[4], gap: space[3] },

  composeCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: space[4],
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    gap: 4,
  },
  fieldLabel: { ...type.metaStrong, marginBottom: 6 },
  optional:   { color: colors.inkFaint, fontWeight: '500' },

  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  summaryLabel: { ...type.micro, color: colors.tealDark },
  summaryCount: { ...type.bodyStrong, color: colors.ink, marginTop: 2 },
  clearLink:    { ...type.metaStrong, color: colors.tealDark },

  chipsRow: {
    flexDirection: 'row',
    gap: space[2],
    paddingVertical: space[1],
  },

  zoneWrap:  { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  zoneEmpty: { ...type.meta, color: colors.inkFaint, fontStyle: 'italic' },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space[3],
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  zoneChipOn:      { backgroundColor: colors.teal, borderColor: colors.teal },
  zoneChipText:    { ...type.metaStrong, color: colors.tealDark },
  zoneChipCount:   { ...type.micro, color: colors.inkFaint, fontWeight: '700' },
  zoneChipTextOn:  { color: colors.paper },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.ruleFaint,
    borderRadius: radius.pill,
    padding: 3,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive:     { backgroundColor: colors.paper },
  segBtnText:       { ...type.metaStrong, color: colors.inkFaint },
  segBtnTextActive: { color: colors.ink },

  separator: { height: 1, backgroundColor: colors.ruleFaint, marginLeft: space[4] + 36 + space[3] },

  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: colors.paper,
  },
  pickerRowSelected: { backgroundColor: colors.tealSoft },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center' },
  rowName:      { ...type.bodyStrong, flexShrink: 1 },
  rowSubtitle:  { ...type.meta, marginTop: 2 },
  check: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.inkGhost,
    backgroundColor: colors.paper,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.teal, borderColor: colors.teal },

  footer: {
    padding: space[4],
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
  },
});
