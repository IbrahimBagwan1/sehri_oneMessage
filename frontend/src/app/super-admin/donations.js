import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { donationsApi } from '../../api/donations';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const STATUS_CONFIG = {
  pending:  { label: 'Pending',  color: '#D97706', bg: '#FEF3C7' },
  verified: { label: 'Verified', color: '#16A34A', bg: '#DCFCE7' },
  rejected: { label: 'Rejected', color: '#DC2626', bg: '#FEE2E2' },
};

const FILTERS = [
  { key: 'all',      label: 'All'      },
  { key: 'pending',  label: 'Pending'  },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
];

const formatINR = (val) => {
  const n = Number.parseFloat(val);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const formatDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

// Walk the eager-loaded location chain to find a zone-type ancestor.
const resolveZoneName = (location) => {
  let current = location;
  let hops = 0;
  while (current && current.type !== 'zone' && hops < 10) {
    current = current.parent || null;
    hops += 1;
  }
  return current?.type === 'zone' ? current.name : null;
};

// -----------------------------------------------------------------------------
// Screen
// -----------------------------------------------------------------------------
export default function SuperAdminDonationsScreen() {
  const router = useRouter();

  const [filter,      setFilter]      = useState('all');
  const [donations,   setDonations]   = useState([]);
  const [summary,     setSummary]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [actioningId, setActioningId] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const [listRes, summaryRes] = await Promise.all([
        donationsApi.getAll({
          page: 1,
          limit: 100,
          status: filter === 'all' ? undefined : filter,
        }),
        donationsApi.getSummary(),
      ]);
      if (listRes.success) setDonations(listRes.data.donations || []);
      if (summaryRes.success) setSummary(summaryRes.data);
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to load donations';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleUpdateStatus = (id, next, donorName) => {
    const verb = next === 'verified' ? 'verify' : 'reject';
    Alert.alert(
      `${verb.charAt(0).toUpperCase() + verb.slice(1)} donation`,
      `Are you sure you want to ${verb} the donation from ${donorName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb.charAt(0).toUpperCase() + verb.slice(1),
          style: next === 'rejected' ? 'destructive' : 'default',
          onPress: async () => {
            setActioningId(id);
            try {
              await donationsApi.updateStatus(id, next);
              // Optimistic update — drop from view if a filter is in use,
              // otherwise reflect the new status.
              setDonations((prev) =>
                filter === 'all'
                  ? prev.map((d) => (d.id === id ? { ...d, status: next } : d))
                  : prev.filter((d) => d.id !== id)
              );
              load(); // refresh summary
            } catch (err) {
              const msg = err.response?.data?.message || 'Action failed';
              Alert.alert('Error', msg);
            } finally {
              setActioningId(null);
            }
          },
        },
      ]
    );
  };

  const renderCard = ({ item }) => {
    const cfg  = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    const zone = resolveZoneName(item.user?.location);
    const isActioning = actioningId === item.id;

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.donorName}>{item.user?.name || '—'}</Text>
            <Text style={styles.donorMeta}>
              {item.user?.phone || ''}{zone ? ` · ${zone}` : ''}
            </Text>
          </View>
          <View style={styles.amountBox}>
            <Text style={styles.amountText}>{formatINR(item.amount)}</Text>
          </View>
        </View>

        {item.note ? <Text style={styles.noteText}>{item.note}</Text> : null}

        <View style={styles.cardFooter}>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
          <Text style={styles.dateText}>{formatDateTime(item.created_at)}</Text>
        </View>

        {item.status === 'pending' && (
          <View style={styles.actionRow}>
            {isActioning ? (
              <ActivityIndicator color="#0D9488" />
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.verifyBtn]}
                  onPress={() => handleUpdateStatus(item.id, 'verified', item.user?.name || 'donor')}
                >
                  <Ionicons name="checkmark" size={16} color="#FFF" />
                  <Text style={styles.actionText}>Verify</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn]}
                  onPress={() => handleUpdateStatus(item.id, 'rejected', item.user?.name || 'donor')}
                >
                  <Ionicons name="close" size={16} color="#FFF" />
                  <Text style={styles.actionText}>Reject</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Donations</Text>
        <TouchableOpacity onPress={() => load(true)} style={styles.iconBtn}>
          <Ionicons name="refresh" size={20} color="#0D9488" />
        </TouchableOpacity>
      </View>

      {/* Summary banner */}
      {summary && (
        <View style={styles.summaryBanner}>
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Verified</Text>
            <Text style={[styles.summaryValue, { color: '#16A34A' }]}>
              {formatINR(summary.total_amount)}
            </Text>
            <Text style={styles.summaryCount}>{summary.counts?.verified ?? 0} donations</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryCell}>
            <Text style={styles.summaryLabel}>Pending</Text>
            <Text style={[styles.summaryValue, { color: '#D97706' }]}>
              {formatINR(summary.pending_amount)}
            </Text>
            <Text style={styles.summaryCount}>{summary.counts?.pending ?? 0} donations</Text>
          </View>
        </View>
      )}

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0D9488" />
        </View>
      ) : (
        <FlatList
          data={donations}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={['#0D9488']}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="wallet-outline" size={40} color="#CBD5E1" />
              <Text style={styles.emptyText}>No donations found.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },
  backBtn:     { padding: 4 },
  iconBtn:     { padding: 4 },

  summaryBanner: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    marginHorizontal: 14,
    marginTop: 14,
    borderRadius: 12,
    paddingVertical: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  summaryCell:   { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: '#E2E8F0', marginVertical: 4 },
  summaryLabel:  { fontSize: 11, color: '#64748B', textTransform: 'uppercase', fontWeight: '600' },
  summaryValue:  { fontSize: 18, fontWeight: '800', marginTop: 4 },
  summaryCount:  { fontSize: 11, color: '#94A3B8', marginTop: 2 },

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  filterBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#E2E8F0',
  },
  filterBtnActive: { backgroundColor: '#0D9488' },
  filterText:      { fontSize: 12, fontWeight: '600', color: '#64748B' },
  filterTextActive:{ color: '#FFF' },

  listContent: { paddingHorizontal: 14, paddingBottom: 24 },

  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  cardTop:      { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  donorName:    { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  donorMeta:    { fontSize: 12, color: '#64748B', marginTop: 2 },
  amountBox:    { backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  amountText:   { color: '#059669', fontWeight: '700', fontSize: 14 },
  noteText:     { fontSize: 13, color: '#475569', marginBottom: 8 },
  cardFooter:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge:  { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  statusText:   { fontSize: 11, fontWeight: '700' },
  dateText:     { fontSize: 11, color: '#94A3B8' },
  actionRow:    { flexDirection: 'row', gap: 10, marginTop: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10 },
  actionBtn:    { flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  verifyBtn:    { backgroundColor: '#16A34A' },
  rejectBtn:    { backgroundColor: '#DC2626' },
  actionText:   { color: '#FFF', fontWeight: '700', fontSize: 13 },

  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  emptyText: { fontSize: 13, color: '#94A3B8' },
});
