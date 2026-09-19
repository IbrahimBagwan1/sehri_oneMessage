import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { pollsApi } from '../../api/polls';

const ZONE_LABELS = {
  masjid:      'Masjid',
  boys_hostel: "Boys' Hostel",
  stanza:      'Stanza',
  girls:       'Girls',
};

// Format YYYY-MM-DD → "14 Sep 2026"
const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const todayIST = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// ---------------------------------------------------------------------------
// Tab: Poll History — paginated list of past polls
// ---------------------------------------------------------------------------
function HistoryTab() {
  const [polls,   setPolls]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(1);
  const [total,   setTotal]   = useState(0);
  const [error,   setError]   = useState(null);

  const LIMIT = 20;

  const fetchHistory = useCallback(async (pageNum = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = await pollsApi.getHistory(pageNum, LIMIT);
      if (res.success) {
        setPolls(res.data.polls);
        setTotal(res.data.total);
        setPage(pageNum);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load poll history');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchHistory(1); }, [fetchHistory]));

  const totalPages = Math.ceil(total / LIMIT);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0D9488" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={40} color="#DC2626" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => fetchHistory(1)}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (polls.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="bar-chart-outline" size={48} color="#CBD5E1" />
        <Text style={styles.emptyTitle}>No poll history yet</Text>
        <Text style={styles.emptySubtitle}>Past polls will appear here once they close.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={polls}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item }) => (
          <View style={styles.historyCard}>
            <View style={styles.historyCardTop}>
              <Text style={styles.historyDate}>{formatDate(item.date)}</Text>
              <View style={styles.totalVotesBadge}>
                <Text style={styles.totalVotesBadgeText}>{item.total_votes} votes</Text>
              </View>
            </View>
            <Text style={styles.historyQuestion} numberOfLines={2}>{item.question}</Text>
            <View style={styles.historyStats}>
              <View style={styles.historyStatBox}>
                <Text style={[styles.historyStatNum, { color: '#16A34A' }]}>{item.total_yes}</Text>
                <Text style={styles.historyStatLabel}>Yes</Text>
              </View>
              <View style={[styles.historyStatBox, styles.historyStatBoxMid]}>
                <Text style={[styles.historyStatNum, { color: '#DC2626' }]}>{item.total_no}</Text>
                <Text style={styles.historyStatLabel}>No</Text>
              </View>
              <View style={styles.historyStatBox}>
                <Text style={[styles.historyStatNum, { color: '#2563EB' }]}>{item.total_votes}</Text>
                <Text style={styles.historyStatLabel}>Total</Text>
              </View>
            </View>
          </View>
        )}
      />
      {/* Pagination */}
      {totalPages > 1 && (
        <View style={styles.pagination}>
          <TouchableOpacity
            style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
            onPress={() => fetchHistory(page - 1)}
            disabled={page <= 1}
          >
            <Ionicons name="chevron-back" size={18} color={page <= 1 ? '#CBD5E1' : '#0D9488'} />
          </TouchableOpacity>
          <Text style={styles.pageText}>Page {page} of {totalPages}</Text>
          <TouchableOpacity
            style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}
            onPress={() => fetchHistory(page + 1)}
            disabled={page >= totalPages}
          >
            <Ionicons name="chevron-forward" size={18} color={page >= totalPages ? '#CBD5E1' : '#0D9488'} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tab: Date Stats — look up zone breakdown for any specific date
// ---------------------------------------------------------------------------
function DateStatsTab() {
  const [inputDate, setInputDate] = useState(todayIST());
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  const fetchStats = async (date) => {
    if (!date) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await pollsApi.getDateStats(date);
      if (res.success) setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'No poll found for this date');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
      {/* Date input */}
      <View style={styles.card}>
        <Text style={styles.filterLabel}>Look up a date (YYYY-MM-DD)</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={inputDate}
            onChangeText={setInputDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
          <TouchableOpacity
            style={styles.todayBtn}
            onPress={() => {
              const t = todayIST();
              setInputDate(t);
              fetchStats(t);
            }}
          >
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.searchBtn} onPress={() => fetchStats(inputDate)}>
          <Ionicons name="search-outline" size={16} color="#FFF" />
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Loading */}
      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0D9488" />
        </View>
      )}

      {/* Error */}
      {!loading && error && (
        <View style={[styles.centered, { marginTop: 20 }]}>
          <Ionicons name="calendar-outline" size={40} color="#CBD5E1" />
          <Text style={styles.emptyTitle}>No results</Text>
          <Text style={styles.emptySubtitle}>{error}</Text>
        </View>
      )}

      {/* Results */}
      {!loading && data && (
        <View style={styles.card}>
          {/* Poll header */}
          <View style={styles.cardHeader}>
            <Ionicons name="bar-chart-outline" size={20} color="#2563EB" />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.cardTitle}>{formatDate(data.poll.date)}</Text>
              <Text style={styles.cardSubtitle} numberOfLines={2}>{data.poll.question}</Text>
            </View>
          </View>

          {/* Grand total */}
          <View style={styles.grandTotalRow}>
            <View style={styles.totalBox}>
              <Text style={[styles.totalNumber, { color: '#16A34A' }]}>{data.grand_total.yes}</Text>
              <Text style={styles.totalLabel}>Yes</Text>
            </View>
            <View style={[styles.totalBox, styles.totalBoxMid]}>
              <Text style={[styles.totalNumber, { color: '#DC2626' }]}>{data.grand_total.no}</Text>
              <Text style={styles.totalLabel}>No</Text>
            </View>
            <View style={styles.totalBox}>
              <Text style={[styles.totalNumber, { color: '#2563EB' }]}>{data.grand_total.total}</Text>
              <Text style={styles.totalLabel}>Total</Text>
            </View>
          </View>

          {/* Per-zone */}
          {Object.entries(data.by_zone).map(([zone, counts]) => (
            <View key={zone} style={styles.zoneRow}>
              <Text style={styles.zoneName}>{ZONE_LABELS[zone] || zone}</Text>
              <View style={styles.zoneStats}>
                <Text style={styles.zoneYes}>✓ {counts.yes}</Text>
                <Text style={styles.zoneNo}>✗ {counts.no}</Text>
                <Text style={styles.zoneTotal}>{counts.total}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main screen — tabbed layout
// ---------------------------------------------------------------------------
export default function SuperAdminPollsScreen() {
  const router   = useRouter();
  const [tab, setTab] = useState('history'); // 'history' | 'date'

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Poll History</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Tab switcher */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'history' && styles.tabBtnActive]}
          onPress={() => setTab('history')}
        >
          <Text style={[styles.tabBtnText, tab === 'history' && styles.tabBtnTextActive]}>
            All Polls
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'date' && styles.tabBtnActive]}
          onPress={() => setTab('date')}
        >
          <Text style={[styles.tabBtnText, tab === 'date' && styles.tabBtnTextActive]}>
            By Date
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab content */}
      <View style={{ flex: 1 }}>
        {tab === 'history' ? <HistoryTab /> : <DateStatsTab />}
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F9FAFB' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },
  backButton:  { padding: 4 },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive:     { borderBottomColor: '#0D9488' },
  tabBtnText:       { fontSize: 14, fontWeight: '600', color: '#9CA3AF' },
  tabBtnTextActive: { color: '#0D9488' },

  // Card
  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  cardTitle:    { fontSize: 15, fontWeight: '700', color: '#1E293B' },
  cardSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },

  // History card
  historyCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  historyCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  historyDate:         { fontSize: 13, fontWeight: '700', color: '#0D9488' },
  totalVotesBadge:     { backgroundColor: '#F0FDF9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  totalVotesBadgeText: { fontSize: 11, fontWeight: '600', color: '#0D9488' },
  historyQuestion:     { fontSize: 13, color: '#475569', marginBottom: 10 },
  historyStats: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  historyStatBox:    { flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: '#F8FAFC' },
  historyStatBoxMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#E2E8F0' },
  historyStatNum:    { fontSize: 18, fontWeight: '800' },
  historyStatLabel:  { fontSize: 11, color: '#64748B', marginTop: 2 },

  // Date stats
  filterLabel: { fontSize: 13, fontWeight: '600', color: '#4B5563', marginBottom: 8 },
  inputRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    fontSize: 15,
    color: '#1F2937',
  },
  todayBtn:      { backgroundColor: '#F1F5F9', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 8 },
  todayBtnText:  { color: '#0D9488', fontWeight: '700', fontSize: 13 },
  searchBtn: {
    backgroundColor: '#0D9488',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 8,
    gap: 6,
  },
  searchBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },

  // Grand total
  grandTotalRow: {
    flexDirection: 'row',
    marginBottom: 14,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  totalBox:    { flex: 1, alignItems: 'center', paddingVertical: 10, backgroundColor: '#F8FAFC' },
  totalBoxMid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#E2E8F0' },
  totalNumber: { fontSize: 22, fontWeight: '800' },
  totalLabel:  { fontSize: 11, color: '#64748B', marginTop: 2 },

  // Zone rows
  zoneRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  zoneName:  { fontSize: 14, fontWeight: '600', color: '#334155', flex: 1 },
  zoneStats: { flexDirection: 'row', gap: 14 },
  zoneYes:   { fontSize: 13, fontWeight: '700', color: '#16A34A', minWidth: 34, textAlign: 'center' },
  zoneNo:    { fontSize: 13, fontWeight: '700', color: '#DC2626', minWidth: 34, textAlign: 'center' },
  zoneTotal: { fontSize: 13, fontWeight: '700', color: '#2563EB', minWidth: 34, textAlign: 'center' },

  // Pagination
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFF',
  },
  pageBtn:         { padding: 8 },
  pageBtnDisabled: { opacity: 0.4 },
  pageText:        { fontSize: 13, fontWeight: '600', color: '#475569' },

  // States
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    padding: 32,
  },
  emptyTitle:    { fontSize: 16, fontWeight: '600', color: '#334155' },
  emptySubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center' },
  errorText:     { fontSize: 14, color: '#DC2626', textAlign: 'center' },
  retryBtn:      { backgroundColor: '#0D9488', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 4 },
  retryBtnText:  { color: '#FFF', fontWeight: '600', fontSize: 14 },
});
