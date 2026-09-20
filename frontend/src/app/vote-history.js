import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pollsApi } from '../api/polls';
import { useAuthStore } from '../store/useAuthStore';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  GuestGate,
  Header,
  LoadingState,
} from '../components/ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// My vote history — every past vote the calling user has cast, newest
// first. Backed by GET /api/polls/my-responses (paginated).
// Reached from the Profile screen.
// -----------------------------------------------------------------------------

const ZONE_LABELS = {
  masjid:      'Masjid',
  boys_hostel: "Boys' hostel",
  stanza:      'Stanza',
  girls:       'Girls',
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

// Guest wrapper — vote history requires an authenticated user id.
export default function VoteHistoryScreen() {
  const isGuest = useAuthStore((s) => s.isGuest);
  const router  = useRouter();
  if (isGuest) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Vote history" onBack={() => router.back()} />
        <GuestGate
          icon="stats-chart-outline"
          title="Vote history is for members"
          message="Sign in to see the polls you've taken part in."
        />
      </SafeAreaView>
    );
  }
  return <VoteHistoryAuthed />;
}

function VoteHistoryAuthed() {
  const router = useRouter();

  const [rows, setRows]           = useState([]);
  const [page, setPage]           = useState(1);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]         = useState(null);
  const LIMIT = 20;

  const load = useCallback(async ({ p = 1, isRefresh = false } = {}) => {
    if (p === 1) {
      isRefresh ? setRefreshing(true) : setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);
    try {
      const res = await pollsApi.getMyResponses(p, LIMIT);
      if (res.success) {
        setRows((prev) => (p === 1 ? res.data.responses : [...prev, ...res.data.responses]));
        setTotal(res.data.total);
        setPage(p);
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load your vote history.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load({ p: 1 }); }, [load]));

  const hasMore = rows.length < total;

  const renderRow = ({ item }) => {
    const isYes = item.response === 'yes';
    const outcome = item.sehri_allowed;
    return (
      <Card>
        <View style={styles.rowHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowDate}>{formatDate(item.poll?.date)}</Text>
            {item.poll?.question ? (
              <Text style={styles.rowQuestion} numberOfLines={2}>{item.poll.question}</Text>
            ) : null}
          </View>
          <Chip
            label={isYes ? 'Yes' : 'No'}
            tone={isYes ? 'success' : 'danger'}
            icon={isYes ? 'checkmark-circle-outline' : 'close-circle-outline'}
          />
        </View>

        <View style={styles.rowMeta}>
          <MetaCell label="Zone"           value={ZONE_LABELS[item.zone] || item.zone || '—'} />
          {item.is_special_case && (
            <MetaCell
              label="Special case"
              value={item.special_case_type === 'want' ? 'Add me' : 'Skip me'}
              tone="warn"
            />
          )}
          {outcome && (
            <MetaCell
              label="Allotment"
              value={outcome === 'approved' ? 'Approved' : 'Rejected'}
              tone={outcome === 'approved' ? 'success' : 'danger'}
            />
          )}
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Vote history" onBack={() => router.back()} />

      {loading ? (
        <LoadingState message="Loading your vote history…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load({ p: 1 })} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="stats-chart-outline"
          title="No votes yet"
          message="Once you vote on a Sehri poll, it'll show up here."
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load({ p: 1, isRefresh: true })} colors={[colors.teal]} tintColor={colors.teal} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (!loadingMore && hasMore) load({ p: page + 1 });
          }}
          ListFooterComponent={
            loadingMore
              ? <LoadingState message="Loading more…" compact />
              : hasMore
                ? <View style={styles.loadMoreWrap}>
                    <Button label="Load more" onPress={() => load({ p: page + 1 })} variant="ghost" size="sm" icon="chevron-down" />
                  </View>
                : rows.length > 0
                  ? <Text style={styles.endText}>You've reached the end.</Text>
                  : null
          }
        />
      )}
    </SafeAreaView>
  );
}

function MetaCell({ label, value, tone }) {
  const color =
    tone === 'success' ? colors.success :
    tone === 'warn'    ? colors.warn    :
    tone === 'danger'  ? colors.danger  :
    colors.ink;
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  list:   { padding: space[4], paddingBottom: space[8] },

  rowHead:    { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  rowDate:    { ...type.h3, color: colors.tealDark },
  rowQuestion:{ ...type.meta, marginTop: 2 },

  rowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[4],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  metaCell:  { minWidth: 96 },
  metaLabel: { ...type.micro, color: colors.inkFaint },
  metaValue: { ...type.bodyStrong, marginTop: 2 },

  loadMoreWrap: { alignItems: 'center', paddingVertical: space[3] },
  endText:      { ...type.micro, color: colors.inkGhost, textAlign: 'center', paddingVertical: space[4] },
});
