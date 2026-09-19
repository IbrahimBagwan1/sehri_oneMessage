'use strict';
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useAuthStore } from '../../store/useAuthStore';
import { pollsApi } from '../../api/polls';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PHASE_CONFIG = {
  voting:       { label: 'Voting Open',           color: '#16A34A', bg: '#DCFCE7' },
  special_case: { label: 'Special Case Window',   color: '#D97706', bg: '#FEF3C7' },
  allotment:    { label: 'Allotment in Progress', color: '#7C3AED', bg: '#EDE9FE' },
  status:       { label: 'Final List Ready',      color: '#0369A1', bg: '#E0F2FE' },
  closed:       { label: 'Poll Closed',           color: '#64748B', bg: '#F1F5F9' },
};

const TYPE_CONFIG = {
  want:       { label: 'Wants food',      icon: 'add-circle-outline',    color: '#16A34A', bg: '#DCFCE7' },
  dont_want:  { label: "Doesn't want",    icon: 'remove-circle-outline',  color: '#DC2626', bg: '#FEE2E2' },
};

const ALLOT_CONFIG = {
  approved: { label: 'Approved', icon: 'checkmark-circle', color: '#16A34A', bg: '#DCFCE7' },
  rejected: { label: 'Rejected', icon: 'close-circle',     color: '#DC2626', bg: '#FEE2E2' },
};

// ---------------------------------------------------------------------------
// Single special case card
// ---------------------------------------------------------------------------
function CaseCard({ item, isSuperAdmin, onDecision, deciding }) {
  const typeCfg  = TYPE_CONFIG[item.special_case_type]  || TYPE_CONFIG.want;
  const allotCfg = item.sehri_allowed ? ALLOT_CONFIG[item.sehri_allowed] : null;
  const isPending = item.sehri_allowed === null;

  const time = item.special_case_at
    ? new Date(item.special_case_at).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
      })
    : null;

  return (
    <View style={styles.caseCard}>
      {/* Top row — name + type badge */}
      <View style={styles.caseTopRow}>
        <View style={styles.caseAvatar}>
          <Ionicons name="person" size={16} color="#0D9488" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.caseName}>{item.user?.name || '—'}</Text>
          <Text style={styles.casePhone}>{item.user?.phone || ''}</Text>
        </View>
        <View style={[styles.typeBadge, { backgroundColor: typeCfg.bg }]}>
          <Ionicons name={typeCfg.icon} size={13} color={typeCfg.color} />
          <Text style={[styles.typeBadgeText, { color: typeCfg.color }]}>{typeCfg.label}</Text>
        </View>
      </View>

      {/* Meta row — zone + time */}
      <View style={styles.caseMeta}>
        <View style={styles.caseMetaItem}>
          <Ionicons name="location-outline" size={13} color="#64748B" />
          <Text style={styles.caseMetaText}>{item.zone || '—'}</Text>
        </View>
        <View style={styles.caseMetaItem}>
          <Ionicons name="swap-horizontal-outline" size={13} color="#64748B" />
          <Text style={styles.caseMetaText}>
            Voted: <Text style={{ fontWeight: '700' }}>{item.response?.toUpperCase()}</Text>
          </Text>
        </View>
        {time && (
          <View style={styles.caseMetaItem}>
            <Ionicons name="time-outline" size={13} color="#64748B" />
            <Text style={styles.caseMetaText}>{time}</Text>
          </View>
        )}
      </View>

      {/* Status / action row */}
      {allotCfg ? (
        // Already reviewed
        <View style={[styles.reviewedBadge, { backgroundColor: allotCfg.bg }]}>
          <Ionicons name={allotCfg.icon} size={15} color={allotCfg.color} />
          <Text style={[styles.reviewedText, { color: allotCfg.color }]}>{allotCfg.label}</Text>
        </View>
      ) : isSuperAdmin && isPending ? (
        // Super admin action buttons
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn, deciding && styles.btnDisabled]}
            disabled={deciding}
            onPress={() => onDecision(item.id, 'approved')}
          >
            {deciding ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="checkmark" size={15} color="#FFF" />
                <Text style={styles.actionBtnText}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn, deciding && styles.btnDisabled]}
            disabled={deciding}
            onPress={() => onDecision(item.id, 'rejected')}
          >
            {deciding ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="close" size={15} color="#FFF" />
                <Text style={styles.actionBtnText}>Reject</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        // Zone admin — read only pending
        <View style={[styles.reviewedBadge, { backgroundColor: '#F1F5F9' }]}>
          <Ionicons name="hourglass-outline" size={15} color="#64748B" />
          <Text style={[styles.reviewedText, { color: '#64748B' }]}>Pending super admin review</Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function SpecialCasesScreen() {
  const router      = useRouter();
  const active_role = useAuthStore((state) => state.active_role);
  const isSuperAdmin = active_role === 'super_admin';

  const [data,       setData]       = useState(null);   // full API response data
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [deciding,   setDeciding]   = useState(null);   // response_id currently being decided
  const [filter,     setFilter]     = useState('all');  // 'all' | 'pending' | 'reviewed'

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  const fetchCases = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await pollsApi.getSpecialCases();
      if (res.success) setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load special cases');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchCases(); }, [fetchCases]));

  // ---------------------------------------------------------------------------
  // Single decision (approve / reject one case)
  // ---------------------------------------------------------------------------
  const handleDecision = async (responseId, decision) => {
    setDeciding(responseId);
    try {
      const res = await pollsApi.allotSpecialCases([{ response_id: responseId, decision }]);
      if (res.success) {
        // Update the local state immediately — no need to refetch
        setData((prev) => {
          if (!prev) return prev;
          const updated = prev.cases.map((c) =>
            c.id === responseId ? { ...c, sehri_allowed: decision } : c
          );
          const pendingCount  = updated.filter((c) => c.sehri_allowed === null).length;
          const reviewedCount = updated.filter((c) => c.sehri_allowed !== null).length;
          return {
            ...prev,
            cases: updated,
            pending_count: pendingCount,
            reviewed_count: reviewedCount,
          };
        });
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not save decision';
      Alert.alert('Error', msg);
    } finally {
      setDeciding(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Approve / reject ALL pending at once
  // ---------------------------------------------------------------------------
  const handleBulkDecision = (decision) => {
    const pending = (data?.cases || []).filter((c) => c.sehri_allowed === null);
    if (pending.length === 0) return;

    Alert.alert(
      `${decision === 'approved' ? 'Approve' : 'Reject'} all pending?`,
      `This will ${decision === 'approved' ? 'approve' : 'reject'} ${pending.length} pending case${pending.length > 1 ? 's' : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: decision === 'rejected' ? 'destructive' : 'default',
          onPress: async () => {
            setLoading(true);
            try {
              const decisions = pending.map((c) => ({ response_id: c.id, decision }));
              await pollsApi.allotSpecialCases(decisions);
              await fetchCases(true);
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Bulk action failed');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const cases       = data?.cases || [];
  const poll        = data?.poll;
  const phaseCfg    = PHASE_CONFIG[poll?.phase] || PHASE_CONFIG.closed;
  const pendingCount  = data?.pending_count  ?? 0;
  const reviewedCount = data?.reviewed_count ?? 0;

  const filteredCases = cases.filter((c) => {
    if (filter === 'pending')  return c.sehri_allowed === null;
    if (filter === 'reviewed') return c.sehri_allowed !== null;
    return true;
  });

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Header router={router} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0D9488" />
          <Text style={styles.loadingText}>Loading special cases...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Header router={router} />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color="#DC2626" />
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorSubtitle}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchCases()}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // No poll today
  if (!poll) {
    return (
      <SafeAreaView style={styles.container}>
        <Header router={router} />
        <View style={styles.centered}>
          <Ionicons name="calendar-outline" size={56} color="#CBD5E1" />
          <Text style={styles.emptyTitle}>No poll today</Text>
          <Text style={styles.emptySubtitle}>Special cases will appear once today's poll is created.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Header router={router} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchCases(true); }}
            colors={['#0D9488']}
          />
        }
      >
        {/* Poll summary card */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryDate}>
                {poll.date
                  ? new Date(poll.date + 'T00:00:00').toLocaleDateString('en-GB', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })
                  : '—'}
              </Text>
              <Text style={styles.summaryTotal}>{data?.total ?? 0} special case{(data?.total ?? 0) !== 1 ? 's' : ''}</Text>
            </View>
            <View style={[styles.phaseBadge, { backgroundColor: phaseCfg.bg }]}>
              <Text style={[styles.phaseText, { color: phaseCfg.color }]}>{phaseCfg.label}</Text>
            </View>
          </View>

          {/* Pending / reviewed counters */}
          <View style={styles.countersRow}>
            <View style={styles.counterBox}>
              <Text style={[styles.counterNum, { color: '#D97706' }]}>{pendingCount}</Text>
              <Text style={styles.counterLabel}>Pending</Text>
            </View>
            <View style={[styles.counterBox, styles.counterBoxMid]}>
              <Text style={[styles.counterNum, { color: '#16A34A' }]}>{reviewedCount}</Text>
              <Text style={styles.counterLabel}>Reviewed</Text>
            </View>
            <View style={styles.counterBox}>
              <Text style={[styles.counterNum, { color: '#2563EB' }]}>{data?.total ?? 0}</Text>
              <Text style={styles.counterLabel}>Total</Text>
            </View>
          </View>
        </View>

        {/* Bulk actions — super admin only, when there are pending cases */}
        {isSuperAdmin && pendingCount > 0 && (
          <View style={styles.bulkRow}>
            <Text style={styles.bulkLabel}>{pendingCount} pending — bulk action:</Text>
            <View style={styles.bulkBtns}>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkApprove]}
                onPress={() => handleBulkDecision('approved')}
              >
                <Ionicons name="checkmark-done" size={14} color="#FFF" />
                <Text style={styles.bulkBtnText}>Approve All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, styles.bulkReject]}
                onPress={() => handleBulkDecision('rejected')}
              >
                <Ionicons name="close" size={14} color="#FFF" />
                <Text style={styles.bulkBtnText}>Reject All</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Filter tabs */}
        {cases.length > 0 && (
          <View style={styles.filterRow}>
            {['all', 'pending', 'reviewed'].map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.filterBtnText, filter === f && styles.filterBtnTextActive]}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Empty state */}
        {cases.length === 0 ? (
          <View style={[styles.centered, { marginTop: 40 }]}>
            <Ionicons name="checkmark-circle-outline" size={56} color="#BBF7D0" />
            <Text style={styles.emptyTitle}>No special cases</Text>
            <Text style={styles.emptySubtitle}>
              No one has raised a special case for today's poll yet.
            </Text>
          </View>
        ) : filteredCases.length === 0 ? (
          <View style={[styles.centered, { marginTop: 30 }]}>
            <Text style={styles.emptySubtitle}>No {filter} cases to show.</Text>
          </View>
        ) : (
          filteredCases.map((item) => (
            <CaseCard
              key={item.id}
              item={item}
              isSuperAdmin={isSuperAdmin}
              onDecision={handleDecision}
              deciding={deciding === item.id}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Header component
// ---------------------------------------------------------------------------
function Header({ router }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="#1F2937" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Special Cases</Text>
      <View style={{ width: 32 }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: { padding: 16, paddingBottom: 30 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },
  backButton:  { padding: 4 },

  // Summary card
  summaryCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  summaryRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  summaryDate:   { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  summaryTotal:  { fontSize: 12, color: '#64748B', marginTop: 2 },
  phaseBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  phaseText:     { fontSize: 11, fontWeight: '700' },
  countersRow: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  counterBox:    { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: '#F8FAFC' },
  counterBoxMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#E2E8F0' },
  counterNum:    { fontSize: 20, fontWeight: '800' },
  counterLabel:  { fontSize: 11, color: '#64748B', marginTop: 2 },

  // Bulk actions
  bulkRow: {
    backgroundColor: '#FFF9E6',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    gap: 8,
  },
  bulkLabel:   { fontSize: 13, fontWeight: '600', color: '#92400E' },
  bulkBtns:    { flexDirection: 'row', gap: 10 },
  bulkBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 5,
  },
  bulkApprove: { backgroundColor: '#16A34A' },
  bulkReject:  { backgroundColor: '#DC2626' },
  bulkBtnText: { color: '#FFF', fontSize: 13, fontWeight: '700' },

  // Filter tabs
  filterRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
    gap: 3,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
  },
  filterBtnActive:    { backgroundColor: '#FFF', elevation: 1, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2 },
  filterBtnText:      { fontSize: 13, fontWeight: '600', color: '#94A3B8' },
  filterBtnTextActive:{ color: '#0D9488' },

  // Case card
  caseCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  caseTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  caseAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F0FDF9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  caseName:   { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  casePhone:  { fontSize: 12, color: '#64748B', marginTop: 1 },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '700' },

  caseMeta:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  caseMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  caseMetaText: { fontSize: 12, color: '#64748B' },

  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    gap: 5,
    minHeight: 38,
  },
  approveBtn:     { backgroundColor: '#16A34A' },
  rejectBtn:      { backgroundColor: '#DC2626' },
  btnDisabled:    { opacity: 0.6 },
  actionBtnText:  { color: '#FFF', fontSize: 13, fontWeight: '700' },

  reviewedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
    alignSelf: 'flex-start',
  },
  reviewedText: { fontSize: 12, fontWeight: '600' },

  // States
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 32,
  },
  emptyTitle:    { fontSize: 16, fontWeight: '700', color: '#334155' },
  emptySubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
  loadingText:   { fontSize: 14, color: '#64748B', marginTop: 8 },
  errorTitle:    { fontSize: 16, fontWeight: '700', color: '#DC2626' },
  errorSubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center' },
  retryBtn:      { backgroundColor: '#0D9488', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, marginTop: 4 },
  retryBtnText:  { color: '#FFF', fontWeight: '700', fontSize: 14 },
});
