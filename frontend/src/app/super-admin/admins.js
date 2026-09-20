import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Alert,
  RefreshControl,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../api/client';
import { adminApi } from '../../api/admin';
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
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Super admin — Zone admin management + promote a user to admin / super admin.
//
// Layout:
//   1. Search card at the top — debounced (300 ms) as-you-type search by
//      name or phone. Results include existing roles per user so
//      already-admin / already-super-admin promotions are gated.
//   2. "Current zone admins" list below, grouped by zone, unchanged
//      backend behavior.
//
// Promote flow:
//   Tap a result → sheet appears with a role selector (Admin / Super
//   admin) and — when Admin is chosen — a zone selector. Submitting
//   opens a two-step confirmation, then fires
//   POST /api/admin/users/:id/promote. All the destructive path is
//   guarded so it can't fire on a stray tap.
// -----------------------------------------------------------------------------

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS   = 300;

// --------------------------------------------------------------
// Debounce hook — 300 ms, cancels on unmount.
// --------------------------------------------------------------
const useDebounced = (value, delay = DEBOUNCE_MS) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), delay);
    return () => clearTimeout(h);
  }, [value, delay]);
  return v;
};

export default function SuperAdminAdminsScreen() {
  const router = useRouter();

  // --- Zone admins list -------------------------------------------------
  const [admins, setAdmins]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [busyId, setBusyId]         = useState(null);

  // --- Search state -----------------------------------------------------
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch               = useDebounced(searchInput.trim());
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching]         = useState(false);
  const [searchError, setSearchError]     = useState(null);
  const searchReqId                       = useRef(0);

  // --- Promote sheet state ---------------------------------------------
  const [promoteTarget, setPromoteTarget] = useState(null); // user row
  const [targetRole,    setTargetRole]    = useState(null); // 'admin' | 'super_admin'
  const [zones,         setZones]         = useState([]);
  const [zonesLoading,  setZonesLoading]  = useState(false);
  const [pickedZoneId,  setPickedZoneId]  = useState(null);
  const [confirming,    setConfirming]    = useState(false); // second-step gate
  const [promoting,     setPromoting]     = useState(false);

  // --- Load admins list -------------------------------------------------
  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/list-admins');
      if (res.data.success) setAdmins(res.data.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load zone admins.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // --- Debounced search — runs whenever debouncedSearch changes --------
  useEffect(() => {
    const q = debouncedSearch;
    if (q.length < MIN_QUERY_LEN) {
      setSearchResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const reqId = ++searchReqId.current;
    setSearching(true);
    setSearchError(null);
    (async () => {
      try {
        const res = await adminApi.searchUsers({ q, limit: 20 });
        // Drop stale responses — user has kept typing.
        if (searchReqId.current !== reqId) return;
        setSearchResults(res?.data?.users || []);
      } catch (err) {
        if (searchReqId.current !== reqId) return;
        setSearchError(err?.response?.data?.message || "Couldn't run the search.");
        setSearchResults([]);
      } finally {
        if (searchReqId.current === reqId) setSearching(false);
      }
    })();
  }, [debouncedSearch]);

  const clearSearch = () => {
    setSearchInput('');
    setSearchResults([]);
    setSearchError(null);
  };

  // --- Zones for the promote sheet — load lazily -----------------------
  useEffect(() => {
    if (!promoteTarget || zones.length > 0) return;
    (async () => {
      setZonesLoading(true);
      try {
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch { setZones([]); }
      finally  { setZonesLoading(false); }
    })();
  }, [promoteTarget, zones.length]);

  // --- Open the promote sheet for a specific user ----------------------
  const openPromote = (user) => {
    if (user.status !== 'approved') {
      Alert.alert(
        'User not approved',
        `${user.name} has status "${user.status}". Only approved users can be promoted.`
      );
      return;
    }
    // Default to admin unless they're already an admin, in which case
    // the only remaining upgrade is super_admin.
    const hasAdmin      = (user.existing_roles || []).includes('admin');
    const hasSuperAdmin = (user.existing_roles || []).includes('super_admin');
    if (hasSuperAdmin) {
      Alert.alert('Nothing to do', `${user.name} is already a super admin.`);
      return;
    }
    setPromoteTarget(user);
    setTargetRole(hasAdmin ? 'super_admin' : 'admin');
    setPickedZoneId(null);
    setConfirming(false);
  };

  const closePromote = () => {
    if (promoting) return;
    setPromoteTarget(null);
    setTargetRole(null);
    setPickedZoneId(null);
    setConfirming(false);
  };

  const canSubmit = useMemo(() => {
    if (!promoteTarget || !targetRole) return false;
    if (targetRole === 'admin' && !pickedZoneId) return false;
    return true;
  }, [promoteTarget, targetRole, pickedZoneId]);

  // Two-step confirmation. First tap flips to "confirming" state, the
  // primary button rewords itself, and only a second tap actually fires.
  const handlePromoteTap = () => {
    if (!canSubmit) return;
    if (!confirming) { setConfirming(true); return; }
    submitPromote();
  };

  const submitPromote = async () => {
    if (!promoteTarget || !targetRole) return;
    setPromoting(true);
    try {
      const res = await adminApi.promoteUser(promoteTarget.id, {
        target_role: targetRole,
        zone_location_id: targetRole === 'admin' ? pickedZoneId : undefined,
      });
      if (res.success) {
        Alert.alert('Promoted', res.message || `${promoteTarget.name} promoted.`);
        setPromoteTarget(null);
        setTargetRole(null);
        setPickedZoneId(null);
        setConfirming(false);
        clearSearch();
        load(); // refresh the admin list
      }
    } catch (err) {
      Alert.alert(
        "Couldn't promote",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setPromoting(false);
    }
  };

  // --- Remove admin -----------------------------------------------------
  const handleRemove = (id, name) => {
    Alert.alert(
      `Remove ${name}?`,
      "Their admin access is revoked. Their user account (if any) stays intact.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyId(id);
            try {
              await apiClient.delete(`/admin/admins/${id}`);
              setAdmins((prev) => prev.filter((a) => a.id !== id));
            } catch (err) {
              Alert.alert("Couldn't remove", err?.response?.data?.message || 'Try again.');
            } finally { setBusyId(null); }
          },
        },
      ]
    );
  };

  // --- Grouping for the list --------------------------------------------
  const grouped = admins.reduce((acc, a) => {
    const zoneName = a.zone?.name || 'Unassigned';
    (acc[zoneName] = acc[zoneName] || []).push(a);
    return acc;
  }, {});
  const sections = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  // ------------------------- Render pieces ------------------------------
  const renderAdminRow = (a) => {
    const isBusy = busyId === a.id;
    return (
      <View key={a.id} style={styles.adminRow}>
        <Avatar name={a.name} size={36} />
        <View style={{ flex: 1 }}>
          <View style={styles.adminHead}>
            <Text style={styles.adminName}>{a.name}</Text>
            {a.user_id ? <Chip label="Also a user" tone="teal" /> : null}
          </View>
          <Text style={styles.adminPhone}>{a.phone}</Text>
        </View>
        <Button
          label="Remove"
          onPress={() => handleRemove(a.id, a.name)}
          loading={isBusy}
          variant="ghost"
          size="sm"
          icon="trash-outline"
        />
      </View>
    );
  };

  const renderResult = (user) => {
    const roles = user.existing_roles || ['user'];
    const isSuperAdmin = roles.includes('super_admin');
    const isAdmin      = roles.includes('admin');
    return (
      <Pressable
        key={user.id}
        onPress={() => openPromote(user)}
        disabled={isSuperAdmin}
        style={({ pressed }) => [
          styles.resultRow,
          pressed && !isSuperAdmin && styles.resultRowPressed,
          isSuperAdmin && styles.resultRowDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Promote ${user.name}`}
      >
        <Avatar name={user.name} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={styles.resultName} numberOfLines={1}>{user.name}</Text>
          <Text style={styles.resultPhone} numberOfLines={1}>{user.phone}</Text>
          <View style={styles.resultBadges}>
            <Chip
              label={user.status}
              tone={user.status === 'approved' ? 'success' : user.status === 'pending' ? 'warn' : 'danger'}
            />
            {isSuperAdmin
              ? <Chip label="super admin" tone="gold" icon="key-outline" />
              : isAdmin
                ? <Chip label="admin" tone="teal" icon="shield-checkmark-outline" />
                : null}
            {user.zone?.name ? <Chip label={user.zone.name} tone="neutral" icon="location-outline" /> : null}
          </View>
        </View>
        <Ionicons
          name={isSuperAdmin ? 'lock-closed-outline' : 'chevron-forward'}
          size={18}
          color={isSuperAdmin ? colors.inkGhost : colors.tealDark}
        />
      </Pressable>
    );
  };

  const searchBlock = (
    <Card>
      <Text style={styles.searchLabel}>Search users to promote</Text>
      <Input
        value={searchInput}
        onChangeText={setSearchInput}
        placeholder="Name or phone number"
        icon="search"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      {searchInput.length > 0 && searchInput.trim().length < MIN_QUERY_LEN && (
        <Text style={styles.searchHint}>Type at least {MIN_QUERY_LEN} characters.</Text>
      )}

      {searching && (
        <View style={styles.searchStatus}>
          <ActivityIndicator size="small" color={colors.teal} />
          <Text style={styles.searchStatusText}>Searching…</Text>
        </View>
      )}

      {searchError && (
        <Text style={styles.searchError}>{searchError}</Text>
      )}

      {!searching && !searchError && debouncedSearch.length >= MIN_QUERY_LEN && searchResults.length === 0 && (
        <Text style={styles.searchEmpty}>
          No users match "{debouncedSearch}". Check the spelling, or ask them to register first.
        </Text>
      )}

      {searchResults.length > 0 && (
        <View style={styles.resultsWrap}>
          {searchResults.map((u, i) => (
            <React.Fragment key={u.id}>
              {i > 0 && <View style={styles.resultRule} />}
              {renderResult(u)}
            </React.Fragment>
          ))}
          <Pressable onPress={clearSearch} hitSlop={8} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear results</Text>
          </Pressable>
        </View>
      )}
    </Card>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Zone admins"
        onBack={() => router.back()}
        trailing={
          <Pressable onPress={() => load(true)} hitSlop={8} accessibilityLabel="Refresh">
            <Ionicons name="refresh" size={22} color={colors.teal} />
          </Pressable>
        }
      />

      {loading ? (
        <LoadingState message="Loading zone admins…" />
      ) : (
        <FlatList
          data={error ? [] : sections}
          keyExtractor={([zoneName]) => zoneName}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />
          }
          ListHeaderComponent={
            <View>
              <SectionHeader title="Promote user to admin" subtitle="Search by name or phone" />
              <View style={{ marginBottom: space[5] }}>
                {searchBlock}
              </View>
              <SectionHeader title="Current zone admins" ornament="star" />
              {error && (
                <View style={{ marginBottom: space[3] }}>
                  <Card><ErrorState message={error} onRetry={() => load()} /></Card>
                </View>
              )}
            </View>
          }
          renderItem={({ item: [zoneName, zoneAdmins] }) => (
            <View style={{ marginBottom: space[4] }}>
              <View style={styles.groupHeader}>
                <Ionicons name="location-outline" size={13} color={colors.gold} />
                <Text style={styles.groupTitle}>{zoneName}</Text>
                <View style={styles.groupCount}>
                  <Text style={styles.groupCountText}>{zoneAdmins.length}</Text>
                </View>
              </View>
              <Card padding={false}>
                {zoneAdmins.map((a, i) => (
                  <React.Fragment key={a.id}>
                    {i > 0 && <View style={styles.rowRule} />}
                    <View style={{ paddingHorizontal: space[4], paddingVertical: space[3] }}>
                      {renderAdminRow(a)}
                    </View>
                  </React.Fragment>
                ))}
              </Card>
            </View>
          )}
          ListEmptyComponent={
            !error && (
              <EmptyState
                icon="shield-outline"
                title="No zone admins yet"
                message="Use the search above to promote an existing user to admin."
              />
            )
          }
        />
      )}

      {/* --------- Promote-to-admin bottom sheet --------- */}
      <Modal
        visible={!!promoteTarget}
        animationType="slide"
        transparent
        onRequestClose={closePromote}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalSheet}
          >
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Promote user</Text>

            {promoteTarget && (
              <View style={styles.modalUserRow}>
                <Avatar name={promoteTarget.name} size={44} />
                <View style={{ flex: 1, marginLeft: space[3] }}>
                  <Text style={styles.modalUserName}>{promoteTarget.name}</Text>
                  <Text style={styles.modalUserPhone}>{promoteTarget.phone}</Text>
                </View>
              </View>
            )}

            {/* Role selector — hide 'admin' if the user is already an admin */}
            <Text style={styles.modalLabel}>Role</Text>
            <View style={styles.roleRow}>
              {!(promoteTarget?.existing_roles || []).includes('admin') && (
                <RoleTile
                  active={targetRole === 'admin'}
                  onPress={() => { setTargetRole('admin'); setConfirming(false); }}
                  icon="shield-checkmark-outline"
                  title="Zone admin"
                  hint="Approves users, sees zone-scoped data."
                />
              )}
              <RoleTile
                active={targetRole === 'super_admin'}
                onPress={() => { setTargetRole('super_admin'); setConfirming(false); }}
                icon="key-outline"
                title="Super admin"
                hint="Full access. Grants nothing higher."
              />
            </View>

            {/* Zone picker — only for admin */}
            {targetRole === 'admin' && (
              <>
                <Text style={styles.modalLabel}>Assign to zone</Text>
                {zonesLoading ? (
                  <LoadingState message="Loading zones…" compact />
                ) : zones.length === 0 ? (
                  <Text style={styles.modalEmpty}>No zones available.</Text>
                ) : (
                  <View style={styles.zoneChips}>
                    {zones.map((z) => (
                      <Chip
                        key={z.id}
                        label={z.name}
                        tone={pickedZoneId === z.id ? 'teal' : 'neutral'}
                        selected={pickedZoneId === z.id}
                        icon="location-outline"
                        onPress={() => { setPickedZoneId(z.id); setConfirming(false); }}
                      />
                    ))}
                  </View>
                )}
              </>
            )}

            {/* Confirmation strip — visible only after first "Promote" tap */}
            {confirming && (
              <View style={styles.confirmStrip}>
                <Ionicons name="alert-circle" size={16} color={colors.gold} />
                <Text style={styles.confirmStripText}>
                  Tap "Confirm promotion" to complete. This grants privileged access.
                </Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                onPress={closePromote}
                variant="secondary"
                style={{ flex: 1 }}
                disabled={promoting}
              />
              <Button
                label={promoting
                  ? 'Promoting…'
                  : confirming ? 'Confirm promotion' : 'Promote'}
                onPress={handlePromoteTap}
                loading={promoting}
                disabled={!canSubmit || promoting}
                icon={confirming ? 'checkmark-circle' : 'arrow-forward'}
                style={{ flex: 1.2 }}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// RoleTile — a clear, tappable card for the role selector
// -----------------------------------------------------------------------------
function RoleTile({ active, onPress, icon, title, hint }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.roleTile,
        active && styles.roleTileActive,
        pressed && !active && styles.roleTilePressed,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!active }}
    >
      <View style={[styles.roleIcon, active && styles.roleIconActive]}>
        <Ionicons name={icon} size={20} color={active ? colors.paper : colors.tealDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.roleTitle, active && styles.roleTitleActive]}>{title}</Text>
        <Text style={styles.roleHint} numberOfLines={2}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  list: { padding: space[4], paddingBottom: space[8] },

  // Search block
  searchLabel: { ...type.metaStrong, color: colors.inkMuted, marginBottom: space[2] },
  searchHint:  { ...type.meta, color: colors.inkFaint, marginTop: space[2] },
  searchError: { ...type.meta, color: colors.danger,  marginTop: space[3] },
  searchEmpty: { ...type.meta, color: colors.inkFaint, marginTop: space[3] },
  searchStatus:{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] },
  searchStatusText: { ...type.meta, color: colors.inkFaint },

  resultsWrap:  { marginTop: space[3] },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
  },
  resultRowPressed:  { backgroundColor: colors.tealSoft },
  resultRowDisabled: { opacity: 0.55 },
  resultRule:  { height: 1, backgroundColor: colors.ruleFaint, marginVertical: space[1] },
  resultName:  { ...type.bodyStrong },
  resultPhone: { ...type.meta, marginTop: 2 },
  resultBadges:{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  clearBtn:    { alignSelf: 'flex-end', marginTop: space[2], paddingVertical: space[1] },
  clearBtnText:{ ...type.metaStrong, color: colors.teal },

  // Zone-admins list
  groupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    paddingVertical: space[2], marginBottom: space[2],
  },
  groupTitle: { ...type.metaStrong, color: colors.inkMuted, flex: 1 },
  groupCount: {
    backgroundColor: colors.goldSoft, borderRadius: radius.pill,
    paddingHorizontal: space[2], paddingVertical: 2,
    borderWidth: 1, borderColor: colors.goldBorder,
  },
  groupCountText: { ...type.micro, color: colors.gold, fontWeight: '700' },

  rowRule:    { height: 1, backgroundColor: colors.ruleFaint, marginLeft: space[4] },
  adminRow:   { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  adminHead:  { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  adminName:  { ...type.bodyStrong },
  adminPhone: { ...type.meta, marginTop: 2 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[5],
    gap: space[3],
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[2],
  },
  modalTitle: { ...type.h2, textAlign: 'center', marginBottom: space[2] },
  modalUserRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.paperSoft,
    borderRadius: radius.lg,
    padding: space[3],
  },
  modalUserName:  { ...type.h3 },
  modalUserPhone: { ...type.meta, marginTop: 2 },
  modalLabel:     { ...type.metaStrong, color: colors.inkMuted, marginTop: space[2] },
  modalEmpty:     { ...type.meta, color: colors.inkFaint },
  zoneChips:      { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  modalActions:   { flexDirection: 'row', gap: space[2], marginTop: space[3] },

  // Role tiles
  roleRow: { gap: space[2] },
  roleTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    backgroundColor: colors.paper,
    minHeight: 60,
  },
  roleTilePressed: { backgroundColor: colors.paperSoft },
  roleTileActive:  { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  roleIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.tealSoft, borderWidth: 1, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  roleIconActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  roleTitle:      { ...type.bodyStrong },
  roleTitleActive:{ color: colors.tealDark },
  roleHint:       { ...type.meta, marginTop: 2 },

  // Confirm strip
  confirmStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[3],
    marginTop: space[2],
  },
  confirmStripText: { ...type.meta, color: colors.ink, flex: 1 },
});
