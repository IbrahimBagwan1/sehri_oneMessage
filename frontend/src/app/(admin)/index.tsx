// @ts-nocheck
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/useAuthStore';
import { adminApi } from '../../api/admin';
import { prayersApi } from '../../api/prayers';
import { locationsApi } from '../../api/auth';
import {
  Avatar,
  Button,
  Card,
  Chip,
  ErrorState,
  Header,
  Hero,
  LoadingState,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

const PHASE = {
  voting:       { label: 'Voting open',           tone: 'teal'    },
  special_case: { label: 'Special case window',   tone: 'warn'    },
  allotment:    { label: 'Allotment',             tone: 'gold'    },
  status:       { label: 'Final list',            tone: 'success' },
  closed:       { label: 'Closed',                tone: 'neutral' },
};

const ZONE_LABELS = {
  masjid:      'Masjid',
  boys_hostel: "Boys' hostel",
  stanza:      'Stanza',
  girls:       'Girls',
};

const toMinutes = (t) => {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

const format12h = (t) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return t;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
};

export default function AdminDashboard() {
  const router            = useRouter();
  const user              = useAuthStore((s) => s.user);
  const active_role       = useAuthStore((s) => s.active_role);
  const available_roles   = useAuthStore((s) => s.available_roles);
  const switchRole        = useAuthStore((s) => s.switchRole);
  const setAvailableRoles = useAuthStore((s) => s.setAvailableRoles);

  // -----------------------------------------------------------------------
  // ALL useState calls must be declared before any useEffect that reads
  // them. Earlier revisions had the voters-drill-down useEffect (which
  // references statsData?.poll?.id) BEFORE `const [statsData, …] = useState`,
  // causing a Temporal Dead Zone ReferenceError on first render — the
  // admin dashboard threw on mount and never showed anything. Never
  // re-split these two blocks; useState first, useEffect second.
  // -----------------------------------------------------------------------

  // Link-user-account state (for standalone admins with no linked user).
  const [linkOpen,     setLinkOpen]     = useState(false);
  const [zones,        setZones]        = useState([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [pickedZoneId, setPickedZoneId] = useState(null);
  const [linking,      setLinking]      = useState(false);

  // Zone-voters drill-down state: which zone name is being inspected
  // (null = sheet closed) + the list of voters + a loading flag.
  const [votersZone,    setVotersZone]    = useState(null);
  const [voters,        setVoters]        = useState([]);
  const [votersLoading, setVotersLoading] = useState(false);
  const [votersError,   setVotersError]   = useState(null);

  const [statsData,    setStatsData]    = useState<any>(null);
  const [prayerData,   setPrayerData]   = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingPrayer,setLoadingP]     = useState(true);
  const [statsError,   setStatsError]   = useState<string | null>(null);
  const [refreshing,   setRefreshing]   = useState(false);

  useEffect(() => {
    if (!votersZone || !statsData?.poll?.id) return;
    let alive = true;
    (async () => {
      setVotersLoading(true);
      setVotersError(null);
      setVoters([]);
      try {
        const res = await adminApi.getZoneVoters(statsData.poll.id, votersZone);
        if (!alive) return;
        // Backend groups by zone: res.data.voters is { [zone_key]: [...] }
        const list = res?.data?.voters?.[votersZone] || [];
        setVoters(list);
      } catch (err) {
        if (!alive) return;
        setVotersError(err?.response?.data?.message || "Couldn't load voters.");
      } finally {
        if (alive) setVotersLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [votersZone, statsData?.poll?.id]);

  useEffect(() => {
    if (!linkOpen || zones.length > 0) return;
    (async () => {
      setZonesLoading(true);
      try {
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch { setZones([]); }
      finally  { setZonesLoading(false); }
    })();
  }, [linkOpen, zones.length]);

  const handleLinkSubmit = async () => {
    if (!pickedZoneId) return;
    setLinking(true);
    try {
      const res = await adminApi.linkUserAccount({ location_id: pickedZoneId });
      if (res.success) {
        await setAvailableRoles(res.data.available_roles);
        setLinkOpen(false);
        setPickedZoneId(null);
        Alert.alert('Linked', res.message);
      }
    } catch (err) {
      Alert.alert("Couldn't link", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setLinking(false);
    }
  };

  const firstName = useMemo(() => (user?.name || 'Admin').trim().split(/\s+/)[0], [user?.name]);

  const fetchStats = useCallback(async () => {
    setStatsError(null);
    try {
      const res = await adminApi.getActiveStats();
      if (res.success) setStatsData(res.data);
    } catch {
      setStatsError("Couldn't load today's poll stats.");
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const fetchPrayer = useCallback(async () => {
    try {
      const res = await prayersApi.getToday();
      if (res.success) setPrayerData(res.data);
    } catch {
      // silent — prayer strip is decorative
    } finally {
      setLoadingP(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchStats();
    fetchPrayer();
    const t = setInterval(fetchStats, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchStats, fetchPrayer]));

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchStats(), fetchPrayer()]);
    setRefreshing(false);
  };

  const handleSwitch = async (role) => {
    try {
      await switchRole(role);
      if (role === 'user') router.replace('/(user)');
      else if (role === 'super_admin') router.replace('/super-admin/superadmin-dashboard');
    } catch (err) {
      Alert.alert("Couldn't switch role", err?.response?.data?.message || 'Try again in a moment.');
    }
  };

  const nextPrayer = useMemo(() => {
    if (!prayerData?.timings) return null;
    // Prayer strings from the backend are IST wall-clock times. Comparing
    // them against the device's local clock would give the wrong "next"
    // prayer for anyone whose device isn't set to Asia/Kolkata. Read the
    // current IST hour+minute directly instead — same pattern as the
    // user home screen's readIST().
    let nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(new Date());
      const h = parts.find((p) => p.type === 'hour');
      const m = parts.find((p) => p.type === 'minute');
      if (h && m) {
        nowMins = (parseInt(h.value, 10) % 24) * 60 + parseInt(m.value, 10);
      }
    } catch { /* fall back to device local */ }
    const rows = [
      { key: 'Fajr',    time: prayerData.timings.Fajr    },
      { key: 'Dhuhr',   time: prayerData.timings.Dhuhr   },
      { key: 'Asr',     time: prayerData.timings.Asr     },
      { key: 'Maghrib', time: prayerData.timings.Maghrib },
      { key: 'Isha',    time: prayerData.timings.Isha    },
    ];
    return rows.find((r) => toMinutes(r.time) > nowMins) || rows[0];
  }, [prayerData]);

  const phase      = statsData?.phase || 'closed';
  const phaseCfg   = PHASE[phase] || PHASE.closed;
  const grandTotal = statsData?.grand_total;
  const byZone     = statsData?.by_zone || {};
  const pollDate   = statsData?.poll?.date;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        leading={<Wordmark />}
        trailing={
          <Avatar
            name={user?.name}
            size={38}
            onPress={() => router.push('/profile')}
            accessibilityLabel="Open profile"
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.teal]} tintColor={colors.teal} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Hero
          greeting={active_role === 'super_admin' ? 'Super admin' : 'Zone admin'}
          name={firstName}
          dateLine={prayerData?.date_hijri || undefined}
        />

        {/* Role switcher — see comment in super-admin/superadmin-dashboard.js
            for why we render a "link a user account" card when the admin
            was created in standalone mode (no linked user_id). */}
        {(() => {
          const others = available_roles.filter((r) => r !== active_role);
          if (others.length === 0 && active_role === 'admin' && !available_roles.includes('user')) {
            return (
              <View style={styles.section}>
                <Card tone="warm">
                  <View style={styles.linkCardRow}>
                    <View style={styles.linkCardIcon}>
                      <Ionicons name="swap-horizontal-outline" size={20} color={colors.gold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.linkCardTitle}>Enable role switching</Text>
                      <Text style={styles.linkCardBody}>
                        You don't have a linked user account yet. Link one to switch to
                        the user view and take part in polls, tracking, and chat.
                      </Text>
                    </View>
                  </View>
                  <Button
                    label="Link a user account"
                    onPress={() => setLinkOpen(true)}
                    icon="link-outline"
                    size="sm"
                    style={{ marginTop: space[3], alignSelf: 'flex-start' }}
                  />
                </Card>
              </View>
            );
          }
          if (others.length === 0) return null;
          return (
            <View style={styles.roleRow}>
              <Text style={styles.roleLabel}>Switch to</Text>
              <View style={styles.roleChips}>
                {available_roles.includes('user') && (
                  <Chip label="User" tone="teal" icon="person-outline" onPress={() => handleSwitch('user')} />
                )}
                {available_roles.includes('super_admin') && (
                  <Chip label="Super admin" tone="teal" icon="key-outline" onPress={() => handleSwitch('super_admin')} />
                )}
              </View>
            </View>
          );
        })()}

        {/* Prayer strip */}
        {nextPrayer && (
          <View style={styles.section}>
            <Card tone="teal" padding={false}>
              <View style={styles.prayerStrip}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prayerEyebrow}>Next prayer</Text>
                  <Text style={styles.prayerLabel}>{nextPrayer.key}</Text>
                </View>
                <Text style={styles.prayerTime}>{format12h(nextPrayer.time)}</Text>
              </View>
            </Card>
          </View>
        )}

        {/* Poll stats */}
        <View style={styles.section}>
          <SectionHeader
            title="Today's Sehri poll"
            subtitle={pollDate}
            trailing={<Chip label={phaseCfg.label} tone={phaseCfg.tone} />}
          />

          {loadingStats ? (
            <Card><LoadingState message="Loading today's stats…" compact /></Card>
          ) : statsError ? (
            <Card><ErrorState message={statsError} onRetry={fetchStats} /></Card>
          ) : grandTotal ? (
            <Card padding={false}>
              {/* Grand total strip */}
              <View style={styles.totalStrip}>
                <TotalCell label="Yes"   value={grandTotal.yes}   tone={colors.success} />
                <View style={styles.totalDivider} />
                <TotalCell label="No"    value={grandTotal.no}    tone={colors.danger} />
                <View style={styles.totalDivider} />
                <TotalCell label="Total" value={grandTotal.total} tone={colors.teal} />
              </View>

              {/* Per-zone breakdown — tap a row to open the drill-down
                  sheet with the list of Yes voters in that zone.
                  Drill-down is ONLY allowed for the caller's own zone
                  (backend rejects cross-zone GET /:id/zone-voters with
                  a 403). We gate the affordance to match: zone admins
                  see rows for all zones the backend returned (which,
                  post-item-6, is only their own), but tap-through only
                  fires when the row IS their zone. This is defensive —
                  today the backend only returns one zone for admins,
                  but if that ever regresses the frontend still won't
                  send a request it knows will be rejected. */}
              <View style={styles.zoneList}>
                {Object.entries(byZone).map(([zone, counts], idx, arr) => {
                  const isMyZone = active_role === 'super_admin' || statsData?.my_zone === zone;
                  const canDrill = isMyZone && counts.yes > 0 && statsData?.poll?.id;
                  return (
                    <View key={zone}>
                      <Pressable
                        onPress={() => { if (canDrill) setVotersZone(zone); }}
                        style={({ pressed }) => [styles.zoneRow, pressed && canDrill && { backgroundColor: colors.tealSoft }]}
                        accessibilityRole="button"
                        accessibilityLabel={
                          canDrill
                            ? `${ZONE_LABELS[zone] || zone}: ${counts.yes} yes voters, tap to view`
                            : `${ZONE_LABELS[zone] || zone}: ${counts.yes} yes voters`
                        }
                        disabled={!canDrill}
                      >
                        <Text style={styles.zoneName}>{ZONE_LABELS[zone] || zone}</Text>
                        <View style={styles.zoneStats}>
                          <Text style={[styles.zoneNumber, { color: colors.success }]}>{counts.yes}</Text>
                          <Text style={[styles.zoneNumber, { color: colors.danger }]}>{counts.no}</Text>
                          <Text style={[styles.zoneNumber, { color: colors.tealDark }]}>{counts.total}</Text>
                        </View>
                        {canDrill && (
                          <Ionicons name="chevron-forward" size={16} color={colors.inkGhost} style={{ marginLeft: space[2] }} />
                        )}
                      </Pressable>
                      {idx < arr.length - 1 && <View style={styles.zoneRule} />}
                    </View>
                  );
                })}
              </View>
            </Card>
          ) : (
            <Card>
              <Text style={styles.emptyLine}>No poll scheduled for today.</Text>
              <Text style={styles.emptyBody}>The next one opens at 10 pm.</Text>
            </Card>
          )}
        </View>

        {/* Quick actions */}
        <View style={styles.section}>
          <SectionHeader title="Quick actions" />
          <View style={styles.grid}>
            <QuickAction icon="people-outline"      label="Approve users" onPress={() => router.push('/(admin)/users')} />
            <QuickAction icon="chatbubble-outline"  label="Feedback"      onPress={() => router.push('/(admin)/feedback')} />
            <QuickAction icon="chatbubbles-outline" label="Chat"          onPress={() => router.push('/(admin)/chat')} />
          </View>
        </View>
      </ScrollView>

      {/* --------------- Zone voters drill-down sheet --------------- */}
      <Modal
        visible={!!votersZone}
        animationType="slide"
        transparent
        onRequestClose={() => setVotersZone(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              Yes voters — {ZONE_LABELS[votersZone] || votersZone}
            </Text>
            <Text style={styles.modalBody}>
              Everyone in this zone who said yes to Sehri tomorrow.
            </Text>

            {votersLoading ? (
              <LoadingState message="Loading voters…" compact />
            ) : votersError ? (
              <View style={{ paddingVertical: space[4] }}>
                <Text style={{ ...type.meta, color: colors.danger, textAlign: 'center' }}>{votersError}</Text>
              </View>
            ) : voters.length === 0 ? (
              <View style={{ paddingVertical: space[6], alignItems: 'center' }}>
                <Ionicons name="people-outline" size={32} color={colors.inkGhost} />
                <Text style={{ ...type.meta, marginTop: space[2], color: colors.inkFaint }}>
                  No yes voters here yet.
                </Text>
              </View>
            ) : (
              <FlatList
                data={voters}
                keyExtractor={(v) => v.response_id}
                renderItem={({ item }) => (
                  <View style={styles.voterRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.voterName}>{item.user?.name}</Text>
                      <Text style={styles.voterPhone}>{item.user?.phone}</Text>
                    </View>
                    {item.is_special_case && (
                      <Chip label="Special case" tone="gold" />
                    )}
                    {item.sehri_allowed === 'approved' && (
                      <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    )}
                    {item.sehri_allowed === 'rejected' && (
                      <Ionicons name="close-circle" size={18} color={colors.danger} />
                    )}
                  </View>
                )}
                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.ruleFaint }} />}
                style={{ marginTop: space[2] }}
              />
            )}

            <View style={{ marginTop: space[3] }}>
              <Button label="Close" variant="secondary" onPress={() => setVotersZone(null)} fullWidth />
            </View>
          </View>
        </View>
      </Modal>

      {/* --------------- Link-user-account bottom sheet --------------- */}
      <Modal
        visible={linkOpen}
        animationType="slide"
        transparent
        onRequestClose={() => (linking ? null : setLinkOpen(false))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Link a user account</Text>
            <Text style={styles.modalBody}>
              This creates a user record for {user?.name || 'you'} in the zone you pick,
              reusing your existing password. You'll be able to switch between roles
              from the dashboard.
            </Text>

            <Text style={styles.modalLabel}>Pick your zone</Text>
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
                    onPress={() => setPickedZoneId(z.id)}
                  />
                ))}
              </View>
            )}

            <View style={styles.modalActions}>
              <Button label="Cancel" onPress={() => setLinkOpen(false)} variant="secondary" style={{ flex: 1 }} disabled={linking} />
              <Button
                label={linking ? 'Linking…' : 'Link account'}
                onPress={handleLinkSubmit}
                loading={linking}
                disabled={!pickedZoneId || linking}
                icon="checkmark"
                style={{ flex: 1.2 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Wordmark() {
  return (
    <View style={styles.wordmarkRow}>
      <View style={styles.wordmarkDot} />
      <Text style={styles.wordmark}>OneMessage</Text>
    </View>
  );
}

function TotalCell({ label, value, tone }) {
  return (
    <View style={styles.totalCell}>
      <Text style={[styles.totalValue, { color: tone }]}>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]}
    >
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={22} color={colors.tealDark} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { paddingBottom: space[8] },

  wordmarkRow: { flexDirection: 'row', alignItems: 'center' },
  wordmarkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal, marginRight: space[2] },
  wordmark:    { fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },

  roleRow:    { paddingHorizontal: space[5], paddingBottom: space[3], gap: space[2] },
  roleLabel:  { ...type.meta, color: colors.inkFaint },
  roleChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },

  section: { paddingHorizontal: space[4], paddingTop: space[4] },

  prayerStrip: {
    flexDirection: 'row', alignItems: 'center', padding: space[4],
  },
  prayerEyebrow: { ...type.micro, color: colors.tealDark, fontWeight: '700' },
  prayerLabel:   { ...type.h2, marginTop: 2 },
  prayerTime:    { fontSize: 22, fontWeight: '800', color: colors.tealDark, letterSpacing: -0.3 },

  totalStrip: {
    flexDirection: 'row',
    paddingVertical: space[3],
  },
  totalCell:    { flex: 1, alignItems: 'center' },
  totalDivider: { width: 1, backgroundColor: colors.ruleSoft },
  totalValue:   { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  totalLabel:   { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  zoneList:    { borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  zoneRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space[4], paddingVertical: space[3] },
  zoneRule:    { height: 1, backgroundColor: colors.ruleFaint, marginHorizontal: space[4] },
  zoneName:    { ...type.body, fontWeight: '600' },
  zoneStats:   { flexDirection: 'row', gap: space[4] },
  zoneNumber:  { fontSize: 15, fontWeight: '700', minWidth: 36, textAlign: 'right' },

  emptyLine: { ...type.h3 },
  emptyBody: { ...type.body, marginTop: space[1] },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  quickAction: {
    width: '47%',
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: space[4],
    alignItems: 'flex-start',
    gap: space[2],
    borderWidth: 1,
    borderColor: colors.ruleSoft,
  },
  quickActionPressed: { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  quickIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  quickLabel: { ...type.bodyStrong, color: colors.ink },

  // Link-user-account inline card
  linkCardRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  linkCardIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.goldBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  linkCardTitle: { ...type.h3 },
  linkCardBody:  { ...type.body, marginTop: 4 },

  // Voter row (drill-down sheet)
  voterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
  },
  voterName:  { ...type.bodyStrong },
  voterPhone: { ...type.meta, marginTop: 2 },

  // Link-user-account modal
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
  modalTitle: { ...type.h2, textAlign: 'center' },
  modalBody:  { ...type.body, color: colors.inkMuted, textAlign: 'center' },
  modalLabel: { ...type.metaStrong, color: colors.inkMuted, marginTop: space[2] },
  modalEmpty: { ...type.meta, color: colors.inkFaint },
  zoneChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  modalActions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
});