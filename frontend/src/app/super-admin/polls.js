import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pollsApi } from '../../api/polls';
import {
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

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function SuperAdminPolls() {
  const router = useRouter();
  const [tab, setTab] = useState('history');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Poll history" onBack={() => router.back()} />

      <View style={styles.tabRow}>
        <TabButton active={tab === 'history'} label="All polls" onPress={() => setTab('history')} />
        <TabButton active={tab === 'date'}    label="By date"   onPress={() => setTab('date')}   />
      </View>

      {tab === 'history' ? <HistoryTab /> : <DateStatsTab />}
    </SafeAreaView>
  );
}

function TabButton({ active, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// Tab 1: All polls (paginated)
// -----------------------------------------------------------------------------
function HistoryTab() {
  const [polls, setPolls]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const [total, setTotal]     = useState(0);
  const [error, setError]     = useState(null);
  const LIMIT = 20;

  const fetchHistory = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = await pollsApi.getHistory(p, LIMIT);
      if (res.success) {
        setPolls(res.data.polls);
        setTotal(res.data.total);
        setPage(p);
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load past polls.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchHistory(1); }, [fetchHistory]));

  const totalPages = Math.ceil(total / LIMIT);

  if (loading) return <LoadingState message="Loading past polls…" />;
  if (error)   return <ErrorState message={error} onRetry={() => fetchHistory(1)} />;
  if (polls.length === 0) return <EmptyState icon="stats-chart-outline" title="No past polls" message="Once the daily polls run, they'll show up here." />;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={polls}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.historyHead}>
              <Text style={styles.historyDate}>{formatDate(item.date)}</Text>
              <Chip label={`${item.total_votes} votes`} tone="teal" />
            </View>
            {item.question ? <Text style={styles.historyQ} numberOfLines={2}>{item.question}</Text> : null}

            <View style={styles.miniStrip}>
              <StatCell label="Yes"   value={item.total_yes}   color={colors.success} />
              <View style={styles.statDivider} />
              <StatCell label="No"    value={item.total_no}    color={colors.danger}  />
              <View style={styles.statDivider} />
              <StatCell label="Total" value={item.total_votes} color={colors.tealDark} />
            </View>
          </Card>
        )}
      />

      {totalPages > 1 && (
        <View style={styles.pagination}>
          <Button label="Previous" onPress={() => fetchHistory(page - 1)} disabled={page <= 1}         variant="ghost"     size="sm" icon="chevron-back" />
          <Text style={styles.pageText}>Page {page} of {totalPages}</Text>
          <Button label="Next"     onPress={() => fetchHistory(page + 1)} disabled={page >= totalPages} variant="ghost"     size="sm" icon="chevron-forward" iconRight />
        </View>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Tab 2: Zone breakdown for a specific date
// -----------------------------------------------------------------------------
function DateStatsTab() {
  const [inputDate, setInputDate] = useState(todayIST());
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const fetchStats = async (date) => {
    if (!date) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await pollsApi.getDateStats(date);
      if (res.success) setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || `No poll on record for ${date}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <SectionHeader title="Look up a date" />
      <Card>
        <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
        <Input
          value={inputDate}
          onChangeText={setInputDate}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          icon="calendar-outline"
        />
        <View style={styles.searchActions}>
          <Button label="Today" onPress={() => { const t = todayIST(); setInputDate(t); fetchStats(t); }} variant="secondary" size="sm" />
          <Button label="Look up" onPress={() => fetchStats(inputDate)} size="sm" icon="search-outline" />
        </View>
      </Card>

      {loading && <LoadingState message="Loading stats…" compact />}

      {!loading && error && (
        <View style={{ marginTop: space[4] }}>
          <Card><EmptyState icon="calendar-outline" title="No results" message={error} /></Card>
        </View>
      )}

      {!loading && data && (
        <View style={{ marginTop: space[4] }}>
          <Card padding={false}>
            <View style={styles.dateHead}>
              <Text style={styles.dateTitle}>{formatDate(data.poll.date)}</Text>
              {data.poll.question ? <Text style={styles.dateSub} numberOfLines={2}>{data.poll.question}</Text> : null}
            </View>

            <View style={styles.miniStrip}>
              <StatCell label="Yes"   value={data.grand_total.yes}   color={colors.success} />
              <View style={styles.statDivider} />
              <StatCell label="No"    value={data.grand_total.no}    color={colors.danger}  />
              <View style={styles.statDivider} />
              <StatCell label="Total" value={data.grand_total.total} color={colors.tealDark} />
            </View>

            <View style={styles.zoneWrap}>
              {Object.entries(data.by_zone).map(([zone, counts], idx, arr) => (
                <View key={zone}>
                  <View style={styles.zoneRow}>
                    <Text style={styles.zoneLabel}>{ZONE_LABELS[zone] || zone}</Text>
                    <View style={styles.zoneStats}>
                      <Text style={[styles.zoneVal, { color: colors.success }]}>{counts.yes}</Text>
                      <Text style={[styles.zoneVal, { color: colors.danger  }]}>{counts.no}</Text>
                      <Text style={[styles.zoneVal, { color: colors.tealDark }]}>{counts.total}</Text>
                    </View>
                  </View>
                  {idx < arr.length - 1 && <View style={styles.zoneRule} />}
                </View>
              ))}
            </View>
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

function StatCell({ label, value, color }) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    paddingHorizontal: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
  },
  tab: { flex: 1, paddingVertical: space[3], alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.teal },
  tabLabel:  { ...type.body, fontWeight: '600', color: colors.inkFaint },
  tabLabelActive: { color: colors.teal, fontWeight: '700' },

  list: { padding: space[4], paddingBottom: space[8] },

  historyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space[2] },
  historyDate: { ...type.h3, color: colors.tealDark },
  historyQ:    { ...type.meta, marginBottom: space[3] },

  miniStrip: { flexDirection: 'row', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  statCell:  { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: colors.ruleSoft },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  label: { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },
  searchActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], marginTop: space[3] },

  dateHead: { padding: space[4] },
  dateTitle: { ...type.h3 },
  dateSub:   { ...type.meta, marginTop: 2 },

  zoneWrap: {},
  zoneRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space[4], paddingVertical: space[3] },
  zoneRule: { height: 1, backgroundColor: colors.ruleFaint, marginHorizontal: space[4] },
  zoneLabel:{ ...type.body, fontWeight: '600' },
  zoneStats:{ flexDirection: 'row', gap: space[4] },
  zoneVal:  { fontSize: 14, fontWeight: '700', minWidth: 32, textAlign: 'right' },

  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
    backgroundColor: colors.paper,
  },
  pageText: { ...type.meta, fontWeight: '600', color: colors.inkMuted },
});
