import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pollsApi } from '../api/polls';
import { useAuthStore } from '../store/useAuthStore';
import {
  Calendar,
  todayISO,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  GuestGate,
  Header,
  LoadingState,
  SectionHeader,
} from '../components/ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// My vote history — a month calendar the user can tap to see the vote they
// cast on any given day. Backed by GET /api/polls/my-responses.
//
// Why load everything up front instead of paginating:
// a calendar has to know which days carry a vote before you tap them, so
// lazy pagination would leave dots missing on months the user hasn't
// scrolled to yet. One person's vote history is one row per day — even a
// multi-year member is a few hundred rows, so we page through to the end
// once on mount and index it by date. That keeps the dots honest.
// -----------------------------------------------------------------------------

const ZONE_LABELS = {
  masjid:      'Masjid',
  boys_hostel: "Boys' hostel",
  stanza:      'Stanza',
  girls:       'Girls',
};

const formatLongDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  // Construct from numeric parts (not the ISO string) so the date never
  // shifts a day when the device sits behind UTC.
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
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

  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState(null);
  const [selected, setSelected] = useState(todayISO());

  const PAGE = 50;
  const MAX_PAGES = 40; // hard stop — 2000 rows is far beyond any real history

  const load = useCallback(async ({ isRefresh = false } = {}) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      // Page through to the end so every day that has a vote gets a dot.
      const all = [];
      let page = 1;
      let total = 0;
      do {
        const res = await pollsApi.getMyResponses(page, PAGE);
        if (!res.success) break;
        all.push(...(res.data.responses || []));
        total = res.data.total || 0;
        page += 1;
      } while (all.length < total && page <= MAX_PAGES);

      setRows(all);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load your vote history.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Index responses by poll date so both the calendar dots and the
  // detail card below are O(1) lookups.
  const byDate = useMemo(() => {
    const map = {};
    for (const r of rows) {
      const d = r.poll?.date;
      if (d) map[d] = r;
    }
    return map;
  }, [rows]);

  // Dot colour encodes the outcome at a glance:
  //   gold  = raised a special case that day (the notable one)
  //   green = voted yes, red = voted no
  const markers = useMemo(() => {
    const m = {};
    for (const [date, r] of Object.entries(byDate)) {
      m[date] = r.is_special_case ? 'special' : (r.response === 'yes' ? 'yes' : 'no');
    }
    return m;
  }, [byDate]);

  // Oldest recorded vote bounds how far back paging is useful.
  const earliest = useMemo(() => {
    const dates = Object.keys(byDate);
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a < b ? a : b));
  }, [byDate]);

  const selectedVote = selected ? byDate[selected] : null;

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Vote history" onBack={() => router.back()} />
        <LoadingState message="Loading your vote history…" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Vote history" onBack={() => router.back()} />
        <ErrorState message={error} onRetry={() => load()} />
      </SafeAreaView>
    );
  }

  if (rows.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Vote history" onBack={() => router.back()} />
        <EmptyState
          icon="calendar-outline"
          title="No votes yet"
          message="Once you vote on a Sehri poll, the day will be marked on your calendar here."
        />
      </SafeAreaView>
    );
  }

  const yesCount = rows.filter((r) => r.response === 'yes').length;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Vote history" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load({ isRefresh: true })}
            colors={[colors.teal]}
            tintColor={colors.teal}
          />
        }
      >
        {/* Summary strip */}
        <View style={styles.summaryStrip}>
          <SummaryCell label="Polls joined" value={rows.length}             color={colors.tealDark} />
          <View style={styles.summaryDivider} />
          <SummaryCell label="Said yes"     value={yesCount}                color={colors.success} />
          <View style={styles.summaryDivider} />
          <SummaryCell label="Said no"      value={rows.length - yesCount}  color={colors.danger} />
        </View>

        <View style={styles.section}>
          <Card>
            <Calendar
              selected={selected}
              onSelect={setSelected}
              markers={markers}
              minDate={earliest}
              maxDate={todayISO()}
              initialMonth={selected}
            />
            {/* Legend — keeps the dot colours self-explanatory */}
            <View style={styles.legend}>
              <LegendDot color={colors.success} label="Yes" />
              <LegendDot color={colors.danger}  label="No" />
              <LegendDot color={colors.gold}    label="Special case" />
            </View>
          </Card>
        </View>

        {/* Detail for the tapped day */}
        <View style={styles.section}>
          <SectionHeader title={formatLongDate(selected)} ornament="star" />
          {selectedVote ? (
            <VoteDetailCard vote={selectedVote} />
          ) : (
            <Card>
              <View style={styles.noVoteRow}>
                <View style={styles.noVoteIcon}>
                  <Ionicons name="remove-circle-outline" size={20} color={colors.inkFaint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.noVoteTitle}>No vote on this day</Text>
                  <Text style={styles.noVoteBody}>
                    {selected === todayISO()
                      ? "You haven't voted in today's poll yet."
                      : 'There was no poll, or you did not take part.'}
                  </Text>
                </View>
              </View>
            </Card>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function VoteDetailCard({ vote }) {
  const isYes = vote.response === 'yes';
  const outcome = vote.sehri_allowed;
  return (
    <Card>
      <View style={styles.detailHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailEyebrow}>Your vote</Text>
          <Text style={[styles.detailValue, { color: isYes ? colors.success : colors.danger }]}>
            {isYes ? 'Yes — count me in' : 'No — not that day'}
          </Text>
        </View>
        <Ionicons
          name={isYes ? 'checkmark-circle' : 'close-circle'}
          size={28}
          color={isYes ? colors.success : colors.danger}
        />
      </View>

      {vote.poll?.question ? (
        <Text style={styles.detailQuestion}>{vote.poll.question}</Text>
      ) : null}

      <View style={styles.detailMeta}>
        <MetaCell label="Zone" value={ZONE_LABELS[vote.zone] || vote.zone || '—'} />
        {vote.is_special_case && (
          <MetaCell
            label="Special case"
            value={vote.special_case_type === 'want' ? 'Asked to be added' : 'Asked to be removed'}
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
}

function SummaryCell({ label, value, color }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function LegendDot({ color, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
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
  scroll: { paddingBottom: space[8] },

  summaryStrip: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
  },
  summaryCell:    { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: colors.ruleSoft, marginVertical: 4 },
  summaryValue:   { fontSize: 22, fontWeight: '800' },
  summaryLabel:   { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  section: { paddingHorizontal: space[4], paddingTop: space[4] },

  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space[4],
    marginTop: space[2],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:  { width: 6, height: 6, borderRadius: 3 },
  legendText: { ...type.micro, color: colors.inkFaint },

  detailHead:     { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  detailEyebrow:  { ...type.micro, color: colors.inkFaint, fontWeight: '700' },
  detailValue:    { ...type.h3, marginTop: 2 },
  detailQuestion: { ...type.meta, marginTop: space[3], color: colors.inkMuted },

  detailMeta: {
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

  noVoteRow:   { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  noVoteIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.ruleFaint,
    alignItems: 'center', justifyContent: 'center',
  },
  noVoteTitle: { ...type.bodyStrong, color: colors.inkMuted },
  noVoteBody:  { ...type.meta, color: colors.inkFaint, marginTop: 2 },
});
