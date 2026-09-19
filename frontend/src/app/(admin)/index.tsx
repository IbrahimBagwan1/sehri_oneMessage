// @ts-nocheck
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/useAuthStore';
import { adminApi } from '../../api/admin';
import { prayersApi } from '../../api/prayers';
import {
  Avatar,
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
  const router          = useRouter();
  const user            = useAuthStore((s) => s.user);
  const active_role     = useAuthStore((s) => s.active_role);
  const available_roles = useAuthStore((s) => s.available_roles);
  const switchRole      = useAuthStore((s) => s.switchRole);

  const [statsData,    setStatsData]    = useState<any>(null);
  const [prayerData,   setPrayerData]   = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingPrayer,setLoadingP]     = useState(true);
  const [statsError,   setStatsError]   = useState<string | null>(null);
  const [refreshing,   setRefreshing]   = useState(false);

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
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
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

        {/* Role switcher */}
        {available_roles.length > 1 && (
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
        )}

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

              {/* Per-zone breakdown */}
              <View style={styles.zoneList}>
                {Object.entries(byZone).map(([zone, counts], idx, arr) => (
                  <View key={zone}>
                    <View style={styles.zoneRow}>
                      <Text style={styles.zoneName}>{ZONE_LABELS[zone] || zone}</Text>
                      <View style={styles.zoneStats}>
                        <Text style={[styles.zoneNumber, { color: colors.success }]}>{counts.yes}</Text>
                        <Text style={[styles.zoneNumber, { color: colors.danger }]}>{counts.no}</Text>
                        <Text style={[styles.zoneNumber, { color: colors.tealDark }]}>{counts.total}</Text>
                      </View>
                    </View>
                    {idx < arr.length - 1 && <View style={styles.zoneRule} />}
                  </View>
                ))}
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
            <QuickAction icon="people-outline"       label="Approve users"    onPress={() => router.push('/(admin)/users')} />
            <QuickAction icon="alert-circle-outline" label="Special cases"    onPress={() => router.push('/(admin)/special-cases')} />
            <QuickAction icon="chatbubble-outline"   label="Feedback"         onPress={() => router.push('/(admin)/feedback')} />
            <QuickAction icon="chatbubbles-outline"  label="Chat"             onPress={() => router.push('/(admin)/chat')} />
          </View>
        </View>
      </ScrollView>
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
});