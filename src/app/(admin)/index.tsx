import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/useAuthStore';
import { adminApi } from '../../api/admin';
import { prayersApi } from '../../api/prayers';

// Phase label + color mapping
const PHASE_CONFIG = {
  voting:       { label: 'Voting Open',           color: '#16A34A', bg: '#DCFCE7' },
  special_case: { label: 'Special Case Window',   color: '#D97706', bg: '#FEF3C7' },
  allotment:    { label: 'Allotment in Progress', color: '#7C3AED', bg: '#EDE9FE' },
  status:       { label: 'Final List Ready',      color: '#0369A1', bg: '#E0F2FE' },
  closed:       { label: 'Poll Closed',           color: '#64748B', bg: '#F1F5F9' },
};

const ZONE_LABELS = {
  masjid:      'Masjid',
  boys_hostel: "Boys' Hostel",
  stanza:      'Stanza',
  girls:       'Girls',
};

export default function AdminDashboard() {
  const router       = useRouter();
  const user         = useAuthStore((state) => state.user);
  const active_role  = useAuthStore((state) => state.active_role);
  const available_roles = useAuthStore((state) => state.available_roles);
  const logout       = useAuthStore((state) => state.logout);
  const switchRole   = useAuthStore((state) => state.switchRole);

  // Poll stats state
  const [statsData,    setStatsData]    = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Prayer strip state
  const [nextPrayer,    setNextPrayer]    = useState(null);
  const [hijriDate,     setHijriDate]     = useState(null);
  const [loadingPrayer, setLoadingPrayer] = useState(true);

  // ---------------------------------------------------------------------------
  // Fetch poll stats
  // ---------------------------------------------------------------------------
  const fetchStats = useCallback(async () => {
    try {
      setLoadingStats(true);
      const result = await adminApi.getActiveStats();
      if (result.success) setStatsData(result.data);
    } catch (err) {
      console.error('Error fetching poll stats:', err);
    } finally {
      setLoadingStats(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch prayer timings — derive next upcoming prayer for strip
  // ---------------------------------------------------------------------------
  const fetchPrayer = useCallback(async () => {
    try {
      setLoadingPrayer(true);
      const result = await prayersApi.getToday();
      if (result.success) {
        setHijriDate(result.data.date_hijri);
        const { timings } = result.data;
        const now     = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();

        const prayers = [
          { name: 'Fajr',    time: timings?.Fajr    },
          { name: 'Dhuhr',   time: timings?.Dhuhr   },
          { name: 'Asr',     time: timings?.Asr     },
          { name: 'Maghrib', time: timings?.Maghrib  },
          { name: 'Isha',    time: timings?.Isha    },
        ];

        const toMins = (t) => {
          if (!t) return 9999;
          const [h, m] = t.split(':').map(Number);
          return h * 60 + m;
        };

        const upcoming = prayers.find((p) => toMins(p.time) > nowMins);
        setNextPrayer(upcoming || prayers[0]);
      }
    } catch (err) {
      console.error('Error fetching prayers:', err);
    } finally {
      setLoadingPrayer(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchStats();
      fetchPrayer();
      const interval = setInterval(fetchStats, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }, [fetchStats, fetchPrayer])
  );

  // ---------------------------------------------------------------------------
  // Role switch handler
  // ---------------------------------------------------------------------------
  const handleSwitchToUser = async () => {
    try {
      await switchRole('user');
      router.replace('/(user)');
    } catch (err) {
      Alert.alert('Switch Failed', err.response?.data?.message || 'Could not switch role.');
    }
  };

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const phase       = statsData?.phase || 'closed';
  const phaseCfg    = PHASE_CONFIG[phase] || PHASE_CONFIG.closed;
  const grandTotal  = statsData?.grand_total;
  const byZone      = statsData?.by_zone || {};
  const pollDate    = statsData?.poll?.date;

  // For zone admin — only show their zone
  // Token carries zone_location_id; we match by name from the stats keys.
  // super_admin sees all zones.
  const visibleZones = active_role === 'super_admin'
    ? Object.keys(ZONE_LABELS)
    : Object.keys(byZone); // admin sees whatever the backend returned scoped to their zone

  return (
    <SafeAreaView style={styles.container}>
      {/* ------------------------------------------------------------------ */}
      {/* HEADER                                                               */}
      {/* ------------------------------------------------------------------ */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <Text style={styles.welcomeText}>
            {active_role === 'super_admin' ? 'Super Admin' : 'Zone Admin'}
          </Text>
          <Text style={styles.usernameText}>{user?.name || 'Admin'}</Text>
        </View>

        <View style={styles.headerActions}>
          {/* Temp: switch to user role if available */}
          {available_roles.includes('user') && (
            <TouchableOpacity onPress={handleSwitchToUser} style={styles.switchRoleBtn}>
              <Text style={styles.switchRoleText}>User</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => router.push('/profile')}
            style={styles.iconBtn}
            accessibilityLabel="Profile"
          >
            <Ionicons name="person-circle-outline" size={36} color="#1E293B" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ---------------------------------------------------------------- */}
        {/* PRAYER STRIP                                                      */}
        {/* ---------------------------------------------------------------- */}
        <View style={styles.prayerStrip}>
          <Ionicons name="time-outline" size={16} color="#0D9488" />
          {loadingPrayer ? (
            <ActivityIndicator size="small" color="#0D9488" style={{ marginLeft: 8 }} />
          ) : (
            <>
              <Text style={styles.prayerStripLabel}>
                {hijriDate ? `${hijriDate}  ·  ` : ''}
                {nextPrayer ? `Next: ${nextPrayer.name} at ${nextPrayer.time}` : 'Prayer times loaded'}
              </Text>
            </>
          )}
        </View>

        {/* ---------------------------------------------------------------- */}
        {/* TODAY'S POLL STATUS CARD                                          */}
        {/* ---------------------------------------------------------------- */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="restaurant-outline" size={22} color="#2563EB" />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.cardTitle}>Today's Poll</Text>
              {pollDate && <Text style={styles.cardSubtitle}>{pollDate}</Text>}
            </View>
            <View style={[styles.phaseBadge, { backgroundColor: phaseCfg.bg }]}>
              <Text style={[styles.phaseText, { color: phaseCfg.color }]}>{phaseCfg.label}</Text>
            </View>
          </View>

          {loadingStats ? (
            <ActivityIndicator size="large" color="#2563EB" style={{ marginVertical: 20 }} />
          ) : grandTotal ? (
            <>
              {/* Grand total row */}
              <View style={styles.grandTotalRow}>
                <View style={styles.totalBox}>
                  <Text style={styles.totalNumber}>{grandTotal.yes}</Text>
                  <Text style={styles.totalLabel}>Yes</Text>
                </View>
                <View style={[styles.totalBox, styles.totalBoxMiddle]}>
                  <Text style={[styles.totalNumber, { color: '#DC2626' }]}>{grandTotal.no}</Text>
                  <Text style={styles.totalLabel}>No</Text>
                </View>
                <View style={styles.totalBox}>
                  <Text style={[styles.totalNumber, { color: '#2563EB' }]}>{grandTotal.total}</Text>
                  <Text style={styles.totalLabel}>Total</Text>
                </View>
              </View>

              {/* Per-zone breakdown */}
              {visibleZones.map((zone) => {
                const zoneData = byZone[zone];
                if (!zoneData) return null;
                return (
                  <View key={zone} style={styles.zoneRow}>
                    <Text style={styles.zoneName}>{ZONE_LABELS[zone] || zone}</Text>
                    <View style={styles.zoneStats}>
                      <Text style={styles.zoneYes}>✓ {zoneData.yes}</Text>
                      <Text style={styles.zoneNo}>✗ {zoneData.no}</Text>
                      <Text style={styles.zoneTotal}>{zoneData.total}</Text>
                    </View>
                  </View>
                );
              })}
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No poll scheduled for today</Text>
            </View>
          )}
        </View>

        {/* ---------------------------------------------------------------- */}
        {/* QUICK ACTIONS                                                     */}
        {/* ---------------------------------------------------------------- */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActionsGrid}>
          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(admin)/users')}
          >
            <Ionicons name="people-outline" size={28} color="#2563EB" />
            <Text style={styles.quickActionLabel}>Approve Users</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(admin)/special-cases')}
          >
            <Ionicons name="alert-circle-outline" size={28} color="#D97706" />
            <Text style={styles.quickActionLabel}>Special Cases</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(admin)/feedback')}
          >
            <Ionicons name="chatbubble-outline" size={28} color="#7C3AED" />
            <Text style={styles.quickActionLabel}>Feedback</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickActionCard}
            onPress={() => router.push('/(admin)/chat')}
          >
            <Ionicons name="chatbubbles-outline" size={28} color="#0D9488" />
            <Text style={styles.quickActionLabel}>Chat</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F8FAFC' },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  userInfo:     { flexDirection: 'column' },
  welcomeText:  { fontSize: 13, color: '#64748B' },
  usernameText: { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  headerActions:{ flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconBtn:      { padding: 4 },
  switchRoleBtn: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 4,
  },
  switchRoleText: { fontSize: 11, fontWeight: '700', color: '#15803D' },

  scrollContent: { padding: 16, paddingBottom: 30 },

  // Prayer strip
  prayerStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  prayerStripLabel: { fontSize: 13, color: '#0D9488', fontWeight: '500', marginLeft: 8, flex: 1 },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 12,
  },
  cardTitle:    { fontSize: 16, fontWeight: '600', color: '#1E293B' },
  cardSubtitle: { fontSize: 12, color: '#94A3B8', marginTop: 2 },

  // Phase badge
  phaseBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  phaseText: { fontSize: 11, fontWeight: '700' },

  // Grand total
  grandTotalRow: {
    flexDirection: 'row',
    marginBottom: 16,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  totalBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
  },
  totalBoxMiddle: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#E2E8F0',
  },
  totalNumber: { fontSize: 26, fontWeight: '800', color: '#16A34A' },
  totalLabel:  { fontSize: 12, color: '#64748B', marginTop: 2 },

  // Zone rows
  zoneRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  zoneName:  { fontSize: 14, fontWeight: '600', color: '#334155', flex: 1 },
  zoneStats: { flexDirection: 'row', gap: 12 },
  zoneYes:   { fontSize: 14, fontWeight: '700', color: '#16A34A', minWidth: 36, textAlign: 'center' },
  zoneNo:    { fontSize: 14, fontWeight: '700', color: '#DC2626', minWidth: 36, textAlign: 'center' },
  zoneTotal: { fontSize: 14, fontWeight: '700', color: '#2563EB', minWidth: 36, textAlign: 'center' },

  // Empty state
  emptyState: { paddingVertical: 20, alignItems: 'center' },
  emptyText:  { fontSize: 14, color: '#94A3B8' },

  // Section title
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 12,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Quick actions
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickActionCard: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    gap: 8,
  },
  quickActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
  },
});
