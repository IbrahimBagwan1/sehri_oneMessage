import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
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

// -----------------------------------------------------------------------------
// Super admin — special cases review + allotment.
//
// Fetches every special-case row for today's poll from
// GET /api/polls/special-cases (no pagination — endpoint returns all).
//
// Actions are only meaningful during the ALLOTMENT window (5–6 PM IST):
// the backend's POST /api/polls/special-cases/allot rejects with 403
// outside that window. The UI mirrors this — pending rows show
// "Approve" + "Reject" buttons only during ALLOTMENT, and the bulk bar
// is likewise gated.
//
// After each action the list refreshes in-place; no manual pull needed.
// -----------------------------------------------------------------------------

const TYPE_LABELS = {
  want:      { label: 'Wants Sehri',      tone: 'success' },
  dont_want: { label: 'Skip Sehri',       tone: 'warn'    },
};

const OUTCOME_LABELS = {
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle' },
  rejected: { label: 'Rejected', tone: 'danger',  icon: 'close-circle'     },
};

const formatTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
};

export default function SuperAdminSpecialCasesScreen() {
  const router = useRouter();

  const [data, setData]         = useState(null);   // { poll, total, pending_count, reviewed_count, cases }
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState(null);
  const [busyIds, setBusyIds]   = useState({});     // { [response_id]: true } for per-row spinners
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const cases = data?.cases || [];
  const poll  = data?.poll  || null;
  const phase = poll?.phase || 'closed';

  // Split by pending vs reviewed for clearer sectioning.
  const pending  = useMemo(() => cases.filter((c) => c.sehri_allowed === null), [cases]);
  const reviewed = useMemo(() => cases.filter((c) => c.sehri_allowed !== null), [cases]);

  // Only during ALLOTMENT (5–6 PM IST) can we call the allot endpoint.
  const canReview = phase === 'allotment';

  // --- Actions ----------------------------------------------------------
  const submitAllot = async (decisions) => {
    if (decisions.length === 0) return;
    try {
      const res = await pollsApi.allotSpecialCases(decisions);
      if (res.success) {
        // Refresh from source of truth so any skipped ids surface.
        await load(true);
        const parts = [];
        if (res.data.approved > 0) parts.push(`${res.data.approved} approved`);
        if (res.data.rejected > 0) parts.push(`${res.data.rejected} rejected`);
        if (res.data.skipped_count > 0) parts.push(`${res.data.skipped_count} skipped`);
        Alert.alert('Allotment updated', parts.join(' · ') || 'No changes recorded.');
      }
    } catch (err) {
      // Most common: 403 outside the 5–6 PM window.
      Alert.alert(
        "Couldn't save decision",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    }
  };

  const handleRowDecision = async (responseId, decision) => {
    if (!canReview) {
      Alert.alert(
        'Not the allotment window',
        'Approve/reject actions are only allowed between 5 PM and 6 PM IST.'
      );
      return;
    }
    setBusyIds((prev) => ({ ...prev, [responseId]: true }));
    try {
      await submitAllot([{ response_id: responseId, decision }]);
    } finally {
      setBusyIds((prev) => {
        const next = { ...prev };
        delete next[responseId];
        return next;
      });
    }
  };

  const handleBulk = (decision) => {
    if (!canReview || pending.length === 0) return;
    const verb = decision === 'approved' ? 'Approve' : 'Reject';
    Alert.alert(
      `${verb} all pending?`,
      `This ${verb.toLowerCase()}s all ${pending.length} pending request${pending.length === 1 ? '' : 's'} in one go. This can't be undone in the allotment window.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb,
          style: decision === 'rejected' ? 'destructive' : 'default',
          onPress: async () => {
            setBulkBusy(true);
            try {
              await submitAllot(pending.map((c) => ({
                response_id: c.id,
                decision,
              })));
            } finally { setBulkBusy(false); }
          },
        },
      ]
    );
  };

  // --- Phase banner — plain description of what's actionable now --------
  const phaseBanner = useMemo(() => {
    switch (phase) {
      case 'voting':
        return {
          tone:  'neutral',
          icon:  'time-outline',
          title: 'Voting is still open',
          body:  'Special case requests open after voting closes at 10 AM. Nothing to review yet.',
        };
      case 'special_case':
        return {
          tone:  'warn',
          icon:  'hourglass-outline',
          title: 'Requests are being collected',
          body:  'Users can raise special cases until 5 PM. Review begins at 5 PM.',
        };
      case 'allotment':
        return {
          tone:  'gold',
          icon:  'checkmark-done-outline',
          title: 'Allotment is live — approve or reject now',
          body:  'The 5 PM–6 PM window is open. Decide each pending request before 6 PM.',
        };
      case 'status':
        return {
          tone:  'success',
          icon:  'ribbon-outline',
          title: 'Final list published',
          body:  'The kitchen has the confirmed count. Any pending rows will not be included.',
        };
      case 'closed':
      default:
        return {
          tone:  'neutral',
          icon:  'lock-closed-outline',
          title: 'Voting is closed',
          body:  'No special-case activity for this poll.',
        };
    }
  }, [phase]);

  // --- Render -----------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Special cases" onBack={() => router.back()} />
        <LoadingState message="Loading special cases…" />
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Special cases" onBack={() => router.back()} />
        <ErrorState message={error} onRetry={() => load()} />
      </SafeAreaView>
    );
  }
  if (!poll) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Special cases" onBack={() => router.back()} />
        <EmptyState
          icon="calendar-outline"
          title="No poll today"
          message="Special cases will show up here once today's poll opens."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header
        title="Special cases"
        onBack={() => router.back()}
        trailing={
          <Pressable onPress={() => load(true)} hitSlop={8} accessibilityLabel="Refresh">
            <Ionicons name="refresh" size={22} color={colors.teal} />
          </Pressable>
        }
      />

      <FlatList
        data={pending}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />
        }
        ListHeaderComponent={
          <View>
            {/* Phase banner */}
            <Card tone={phaseBanner.tone === 'gold' ? 'warm' : 'paper'}>
              <View style={styles.bannerRow}>
                <View style={[styles.bannerIcon, { backgroundColor: toneBg(phaseBanner.tone), borderColor: toneBorder(phaseBanner.tone) }]}>
                  <Ionicons name={phaseBanner.icon} size={18} color={toneFg(phaseBanner.tone)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bannerTitle}>{phaseBanner.title}</Text>
                  <Text style={styles.bannerBody}>{phaseBanner.body}</Text>
                </View>
              </View>
            </Card>

            {/* Summary strip */}
            <View style={{ marginTop: space[3] }}>
              <Card padding={false}>
                <View style={styles.summaryStrip}>
                  <SummaryCell label="Total"    value={data.total || 0}          color={colors.tealDark} />
                  <View style={styles.summaryDivider} />
                  <SummaryCell label="Pending"  value={data.pending_count || 0}  color={colors.warn} />
                  <View style={styles.summaryDivider} />
                  <SummaryCell label="Reviewed" value={data.reviewed_count || 0} color={colors.success} />
                </View>
              </Card>
            </View>

            {/* Bulk actions — only during allotment, only when pending > 0 */}
            {canReview && pending.length > 0 && (
              <View style={{ marginTop: space[3] }}>
                <Card>
                  <Text style={styles.bulkTitle}>Bulk decide {pending.length} pending</Text>
                  <View style={styles.bulkActions}>
                    <Button
                      label="Approve all"
                      onPress={() => handleBulk('approved')}
                      icon="checkmark-done"
                      size="sm"
                      style={{ flex: 1 }}
                      loading={bulkBusy}
                      disabled={bulkBusy}
                    />
                    <Button
                      label="Reject all"
                      onPress={() => handleBulk('rejected')}
                      icon="close"
                      size="sm"
                      variant="secondary"
                      style={{ flex: 1 }}
                      loading={bulkBusy}
                      disabled={bulkBusy}
                    />
                  </View>
                </Card>
              </View>
            )}

            <View style={{ marginTop: space[4] }}>
              <SectionHeader
                title={pending.length > 0 ? `Pending · ${pending.length}` : 'Pending'}
                ornament="star"
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <RowCard
            row={item}
            canReview={canReview}
            busy={!!busyIds[item.id]}
            onDecision={(decision) => handleRowDecision(item.id, decision)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
        ListEmptyComponent={
          <Card>
            <EmptyState
              icon="checkmark-done-circle-outline"
              title="No pending special cases"
              message={phase === 'voting'
                ? 'The special-case window opens at 10 AM.'
                : 'Nothing new to review right now.'}
            />
          </Card>
        }
        ListFooterComponent={
          reviewed.length > 0 ? (
            <View style={{ marginTop: space[6] }}>
              <SectionHeader title={`Reviewed · ${reviewed.length}`} />
              {reviewed.map((c, i) => (
                <View key={c.id} style={{ marginBottom: i === reviewed.length - 1 ? 0 : space[2] }}>
                  <RowCard row={c} canReview={false} busy={false} onDecision={() => {}} />
                </View>
              ))}
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// RowCard — one special-case request
// -----------------------------------------------------------------------------
function RowCard({ row, canReview, busy, onDecision }) {
  const typeCfg = TYPE_LABELS[row.special_case_type] || { label: row.special_case_type, tone: 'neutral' };
  const outcome = row.sehri_allowed ? OUTCOME_LABELS[row.sehri_allowed] : null;

  return (
    <Card>
      <View style={styles.rowHead}>
        <Avatar name={row.user?.name} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName}>{row.user?.name || 'Unknown'}</Text>
          <Text style={styles.rowPhone}>{row.user?.phone}</Text>
        </View>
        {outcome ? (
          <Chip label={outcome.label} tone={outcome.tone} icon={outcome.icon} />
        ) : (
          <Chip label="Pending" tone="warn" icon="hourglass-outline" />
        )}
      </View>

      <View style={styles.rowMeta}>
        <MetaPair label="Original vote"     value={row.response || '—'} />
        <MetaPair label="Requested change"  value={typeCfg.label} tone={typeCfg.tone} />
        <MetaPair label="Submitted"         value={formatTime(row.special_case_at)} />
      </View>

      {row.sehri_allowed === null && canReview && (
        <View style={styles.rowActions}>
          <Button
            label="Approve"
            onPress={() => onDecision('approved')}
            icon="checkmark"
            size="sm"
            style={{ flex: 1 }}
            loading={busy}
            disabled={busy}
          />
          <Button
            label="Reject"
            onPress={() => onDecision('rejected')}
            icon="close"
            size="sm"
            variant="secondary"
            style={{ flex: 1 }}
            loading={busy}
            disabled={busy}
          />
        </View>
      )}
    </Card>
  );
}

function MetaPair({ label, value, tone }) {
  return (
    <View style={styles.metaCol}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, tone === 'success' && { color: colors.success }, tone === 'warn' && { color: colors.warn }]}>{value}</Text>
    </View>
  );
}

function SummaryCell({ label, value, color }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const toneBg = (tone) => ({
  teal: colors.tealSoft, gold: colors.goldSoft, success: colors.successSoft,
  warn: colors.warnSoft, danger: colors.dangerSoft, neutral: colors.ruleFaint,
}[tone] || colors.ruleFaint);

const toneFg = (tone) => ({
  teal: colors.tealDark, gold: colors.gold, success: colors.success,
  warn: colors.warn, danger: colors.danger, neutral: colors.inkMuted,
}[tone] || colors.inkMuted);

const toneBorder = (tone) => ({
  teal: colors.tealBorder, gold: colors.goldBorder, success: '#BBF7D0',
  warn: '#FDE68A', danger: '#FECACA', neutral: colors.ruleSoft,
}[tone] || colors.ruleSoft);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  list:   { padding: space[4], paddingBottom: space[8] },

  // Banner
  bannerRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  bannerIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  bannerTitle: { ...type.bodyStrong },
  bannerBody:  { ...type.meta, marginTop: 2 },

  // Summary strip
  summaryStrip:    { flexDirection: 'row', paddingVertical: space[3] },
  summaryCell:     { flex: 1, alignItems: 'center' },
  summaryDivider:  { width: 1, backgroundColor: colors.ruleSoft },
  summaryValue:    { fontSize: 20, fontWeight: '800' },
  summaryLabel:    { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  // Bulk
  bulkTitle:   { ...type.h3, marginBottom: space[3] },
  bulkActions: { flexDirection: 'row', gap: space[2] },

  // Row card
  rowHead:  { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowName:  { ...type.bodyStrong },
  rowPhone: { ...type.meta, marginTop: 2 },

  rowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[4],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  metaCol:   { minWidth: 96 },
  metaLabel: { ...type.micro, color: colors.inkFaint },
  metaValue: { ...type.bodyStrong, marginTop: 2, textTransform: 'capitalize' },

  rowActions: {
    flexDirection: 'row',
    gap: space[2],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
});
