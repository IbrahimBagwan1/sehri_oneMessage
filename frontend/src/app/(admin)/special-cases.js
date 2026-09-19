'use strict';
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  RefreshControl,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../../store/useAuthStore';
import { pollsApi } from '../../api/polls';
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

const PHASE = {
  voting:       { label: 'Voting open',           tone: 'teal'    },
  special_case: { label: 'Special case window',   tone: 'warn'    },
  allotment:    { label: 'Allotment',             tone: 'gold'    },
  status:       { label: 'Final list',            tone: 'success' },
  closed:       { label: 'Closed',                tone: 'neutral' },
};

const TYPE_CONFIG = {
  want:      { label: 'Wants Sehri',      icon: 'add-circle-outline',    tone: 'success' },
  dont_want: { label: "Doesn't want",     icon: 'remove-circle-outline', tone: 'danger'  },
};

const ALLOT_CONFIG = {
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle' },
  rejected: { label: 'Rejected', tone: 'danger',  icon: 'close-circle'     },
};

const FILTERS = [
  { key: 'all',      label: 'All'      },
  { key: 'pending',  label: 'Pending'  },
  { key: 'reviewed', label: 'Reviewed' },
];

const formatTime = (iso) => {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function SpecialCasesScreen() {
  const router = useRouter();
  const active_role = useAuthStore((s) => s.active_role);
  const isSuperAdmin = active_role === 'super_admin';

  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [deciding,   setDeciding]   = useState(null);
  const [filter,     setFilter]     = useState('all');

  const fetchCases = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await pollsApi.getSpecialCases();
      if (res.success) setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load special cases.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchCases(); }, [fetchCases]));

  const handleDecision = async (responseId, decision) => {
    setDeciding(responseId);
    try {
      const res = await pollsApi.allotSpecialCases([{ response_id: responseId, decision }]);
      if (res.success) {
        setData((prev) => {
          if (!prev) return prev;
          const updated = prev.cases.map((c) => c.id === responseId ? { ...c, sehri_allowed: decision } : c);
          return {
            ...prev,
            cases: updated,
            pending_count:  updated.filter((c) => c.sehri_allowed === null).length,
            reviewed_count: updated.filter((c) => c.sehri_allowed !== null).length,
          };
        });
      }
    } catch (err) {
      Alert.alert("Couldn't save decision", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setDeciding(null);
    }
  };

  const handleBulk = (decision) => {
    const pending = (data?.cases || []).filter((c) => c.sehri_allowed === null);
    if (pending.length === 0) return;
    const verb = decision === 'approved' ? 'approve' : 'reject';
    Alert.alert(
      `${verb.charAt(0).toUpperCase() + verb.slice(1)} all pending?`,
      `This ${verb}s ${pending.length} case${pending.length > 1 ? 's' : ''} at once.`,
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
              Alert.alert("Couldn't save", err?.response?.data?.message || 'Try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const cases       = data?.cases || [];
  const poll        = data?.poll;
  const phaseCfg    = PHASE[poll?.phase] || PHASE.closed;
  const pendingN    = data?.pending_count  ?? 0;
  const reviewedN   = data?.reviewed_count ?? 0;
  const filtered = useMemo(() => cases.filter((c) => {
    if (filter === 'pending')  return c.sehri_allowed === null;
    if (filter === 'reviewed') return c.sehri_allowed !== null;
    return true;
  }), [cases, filter]);

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Special cases" onBack={() => router.back()} />
        <LoadingState message="Loading special cases…" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Special cases" onBack={() => router.back()} />
        <ErrorState message={error} onRetry={() => fetchCases()} />
      </SafeAreaView>
    );
  }

  if (!poll) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Special cases" onBack={() => router.back()} />
        <EmptyState
          icon="calendar-outline"
          title="No poll today"
          message="Special cases show up here once today's poll is created."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Special cases" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchCases(true)} colors={[colors.teal]} tintColor={colors.teal} />
        }
      >
        {/* Poll summary */}
        <Card>
          <View style={styles.summaryHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryDate}>
                {new Date(`${poll.date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </Text>
              <Text style={styles.summaryMeta}>{data?.total ?? 0} special case{(data?.total ?? 0) !== 1 ? 's' : ''}</Text>
            </View>
            <Chip label={phaseCfg.label} tone={phaseCfg.tone} />
          </View>

          <View style={styles.counters}>
            <CounterCell label="Pending"  value={pendingN}  color={colors.warn} />
            <View style={styles.counterDivider} />
            <CounterCell label="Reviewed" value={reviewedN} color={colors.success} />
            <View style={styles.counterDivider} />
            <CounterCell label="Total"    value={data?.total ?? 0} color={colors.teal} />
          </View>
        </Card>

        {/* Bulk actions (super_admin only, when pending exist) */}
        {isSuperAdmin && pendingN > 0 && (
          <View style={{ marginTop: space[3] }}>
            <Card tone="warm">
              <Text style={styles.bulkTitle}>{pendingN} pending — decide in bulk</Text>
              <View style={styles.bulkRow}>
                <Button label="Approve all" onPress={() => handleBulk('approved')} size="sm" icon="checkmark-done" style={{ flex: 1 }} />
                <Button label="Reject all"  onPress={() => handleBulk('rejected')} size="sm" variant="secondary" icon="close" style={{ flex: 1 }} />
              </View>
            </Card>
          </View>
        )}

        {/* Filter */}
        {cases.length > 0 && (
          <View style={styles.filterRow}>
            {FILTERS.map((f) => (
              <Chip
                key={f.key}
                label={f.label}
                tone={filter === f.key ? 'teal' : 'neutral'}
                selected={filter === f.key}
                onPress={() => setFilter(f.key)}
              />
            ))}
          </View>
        )}

        {/* Cases */}
        {cases.length === 0 ? (
          <View style={{ marginTop: space[4] }}>
            <Card>
              <EmptyState
                icon="checkmark-circle-outline"
                title="No special cases"
                message="Nobody has raised a special case for today's poll yet."
              />
            </Card>
          </View>
        ) : filtered.length === 0 ? (
          <Text style={styles.emptyLine}>No {filter} cases to show.</Text>
        ) : (
          <View style={{ marginTop: space[3], gap: space[2] }}>
            {filtered.map((c) => (
              <CaseCard
                key={c.id}
                item={c}
                isSuperAdmin={isSuperAdmin}
                onDecision={handleDecision}
                deciding={deciding === c.id}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CounterCell({ label, value, color }) {
  return (
    <View style={styles.counterCell}>
      <Text style={[styles.counterValue, { color }]}>{value}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </View>
  );
}

function CaseCard({ item, isSuperAdmin, onDecision, deciding }) {
  const typeCfg = TYPE_CONFIG[item.special_case_type] || TYPE_CONFIG.want;
  const allotCfg = item.sehri_allowed ? ALLOT_CONFIG[item.sehri_allowed] : null;
  const isPending = item.sehri_allowed === null;

  return (
    <Card>
      <View style={styles.caseHead}>
        <Avatar name={item.user?.name} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={styles.caseName}>{item.user?.name || 'Unknown'}</Text>
          <Text style={styles.casePhone}>{item.user?.phone || ''}</Text>
        </View>
        <Chip label={typeCfg.label} tone={typeCfg.tone} icon={typeCfg.icon} />
      </View>

      <View style={styles.caseMeta}>
        <MetaBit icon="location-outline" text={item.zone || '—'} />
        <MetaBit icon="swap-horizontal-outline" text={`Voted ${item.response}`} />
        {formatTime(item.special_case_at) && (
          <MetaBit icon="time-outline" text={formatTime(item.special_case_at)} />
        )}
      </View>

      {allotCfg ? (
        <View style={{ marginTop: space[2] }}>
          <Chip label={allotCfg.label} tone={allotCfg.tone} icon={allotCfg.icon} />
        </View>
      ) : isSuperAdmin && isPending ? (
        <View style={styles.caseActions}>
          <Button label="Approve" onPress={() => onDecision(item.id, 'approved')} loading={deciding} size="sm" icon="checkmark" style={{ flex: 1 }} />
          <Button label="Reject"  onPress={() => onDecision(item.id, 'rejected')} loading={deciding} variant="secondary" size="sm" icon="close" style={{ flex: 1 }} />
        </View>
      ) : (
        <View style={{ marginTop: space[2] }}>
          <Chip label="Awaiting super admin" tone="neutral" icon="hourglass-outline" />
        </View>
      )}
    </Card>
  );
}

function MetaBit({ icon, text }) {
  return (
    <View style={styles.metaBit}>
      <Ionicons name={icon} size={12} color={colors.inkFaint} />
      <Text style={styles.metaBitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { padding: space[4], paddingBottom: space[8] },

  summaryHead:  { flexDirection: 'row', alignItems: 'center', marginBottom: space[3] },
  summaryDate:  { ...type.h3 },
  summaryMeta:  { ...type.meta, marginTop: 2 },

  counters: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
    paddingTop: space[3],
  },
  counterCell:    { flex: 1, alignItems: 'center' },
  counterDivider: { width: 1, backgroundColor: colors.ruleSoft },
  counterValue:   { fontSize: 22, fontWeight: '800' },
  counterLabel:   { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  bulkTitle: { ...type.bodyStrong, color: colors.ink, marginBottom: space[3] },
  bulkRow:   { flexDirection: 'row', gap: space[2] },

  filterRow: { flexDirection: 'row', gap: space[2], marginTop: space[4] },

  emptyLine: { ...type.meta, textAlign: 'center', marginTop: space[6] },

  caseHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3] },
  caseName: { ...type.h3 },
  casePhone: { ...type.meta, marginTop: 2 },

  caseMeta: { flexDirection: 'row', gap: space[3], flexWrap: 'wrap' },
  metaBit:  { flexDirection: 'row', gap: 4, alignItems: 'center' },
  metaBitText: { ...type.meta },

  caseActions: {
    flexDirection: 'row',
    gap: space[2],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
});
