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
import { useRouter, useFocusEffect } from 'expo-router';
import { usersApi } from '../../api/users';

// -----------------------------------------------------------------------------
// Super admin — Profile edit request review screen.
//
// Users submit profile changes (name/gender/occupation/city/location_id/address)
// via POST /api/users/request-profile-edit. This screen lists the pending
// queue and lets a super admin approve or reject each one. On approve the
// backend atomically applies the changes to the users row.
// -----------------------------------------------------------------------------
const STATUS_CONFIG = {
  pending:  { label: 'Pending',  color: '#D97706', bg: '#FEF3C7' },
  approved: { label: 'Approved', color: '#16A34A', bg: '#DCFCE7' },
  rejected: { label: 'Rejected', color: '#DC2626', bg: '#FEE2E2' },
};

const FIELD_LABELS = {
  name:        'Name',
  gender:      'Gender',
  occupation:  'Occupation',
  city:        'City',
  location_id: 'Zone / Address',
  address:     'Address',
};

const resolveZoneName = (location) => {
  let current = location;
  let hops = 0;
  while (current && current.type !== 'zone' && hops < 10) {
    current = current.parent || null;
    hops += 1;
  }
  return current?.type === 'zone' ? current.name : null;
};

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export default function SuperAdminRequestsScreen() {
  const router = useRouter();

  const [filter,     setFilter]     = useState('pending');
  const [requests,   setRequests]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewing,  setReviewing]  = useState(null); // id being decided

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await usersApi.getProfileEditRequests({
        status: filter === 'all' ? undefined : filter,
      });
      if (res.success) setRequests(res.data || []);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to load requests');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDecision = (id, decision, userName) => {
    const verb = decision === 'approved' ? 'approve' : 'reject';
    Alert.alert(
      `${verb.charAt(0).toUpperCase() + verb.slice(1)} request`,
      `Are you sure you want to ${verb} the profile changes for ${userName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb.charAt(0).toUpperCase() + verb.slice(1),
          style: decision === 'rejected' ? 'destructive' : 'default',
          onPress: async () => {
            setReviewing(id);
            try {
              await usersApi.reviewProfileEditRequest(id, decision);
              setRequests((prev) =>
                filter === 'all'
                  ? prev.map((r) => (r.id === id ? { ...r, status: decision } : r))
                  : prev.filter((r) => r.id !== id)
              );
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Failed to review');
            } finally {
              setReviewing(null);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile Edit Requests</Text>
        <TouchableOpacity onPress={() => load(true)} style={styles.iconBtn}>
          <Ionicons name="refresh" size={20} color="#0D9488" />
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {['pending', 'approved', 'rejected', 'all'].map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0D9488" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={['#0D9488']}
            />
          }
        >
          {requests.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="checkbox-outline" size={40} color="#CBD5E1" />
              <Text style={styles.emptyText}>No {filter === 'all' ? '' : filter + ' '}requests.</Text>
            </View>
          ) : (
            requests.map((r) => {
              const cfg  = STATUS_CONFIG[r.status] || STATUS_CONFIG.pending;
              const zone = resolveZoneName(r.user?.location);
              const changes = r.requested_changes || {};
              const isPending = r.status === 'pending';
              const isReviewingThis = reviewing === r.id;

              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName}>{r.user?.name || 'Unknown user'}</Text>
                      <Text style={styles.userMeta}>
                        {r.user?.phone || ''}{zone ? ` · ${zone}` : ''}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>

                  <View style={styles.changesBox}>
                    <Text style={styles.changesTitle}>Requested changes:</Text>
                    {Object.entries(changes).length === 0 ? (
                      <Text style={styles.changeValue}>—</Text>
                    ) : (
                      Object.entries(changes).map(([field, value]) => (
                        <View key={field} style={styles.changeRow}>
                          <Text style={styles.changeLabel}>{FIELD_LABELS[field] || field}:</Text>
                          <Text style={styles.changeValue} numberOfLines={2}>
                            {String(value)}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>

                  <Text style={styles.dateText}>Submitted {formatDate(r.created_at)}</Text>

                  {isPending && (
                    <View style={styles.actionRow}>
                      {isReviewingThis ? (
                        <ActivityIndicator color="#0D9488" />
                      ) : (
                        <>
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.rejectBtn]}
                            onPress={() => handleDecision(r.id, 'rejected', r.user?.name || 'user')}
                          >
                            <Ionicons name="close" size={16} color="#FFF" />
                            <Text style={styles.actionText}>Reject</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionBtn, styles.approveBtn]}
                            onPress={() => handleDecision(r.id, 'approved', r.user?.name || 'user')}
                          >
                            <Ionicons name="checkmark" size={16} color="#FFF" />
                            <Text style={styles.actionText}>Approve</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
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

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  filterBtn:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#E2E8F0' },
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
  cardTop:      { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  userName:     { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  userMeta:     { fontSize: 12, color: '#64748B', marginTop: 2 },
  statusBadge:  { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  statusText:   { fontSize: 11, fontWeight: '700' },

  changesBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  changesTitle: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 6, textTransform: 'uppercase' },
  changeRow:    { flexDirection: 'row', marginBottom: 4 },
  changeLabel:  { fontSize: 13, color: '#64748B', fontWeight: '600', width: 100 },
  changeValue:  { flex: 1, fontSize: 13, color: '#0F172A' },

  dateText:     { fontSize: 11, color: '#94A3B8', marginBottom: 8 },
  actionRow:    { flexDirection: 'row', gap: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10 },
  actionBtn:    { flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  approveBtn:   { backgroundColor: '#16A34A' },
  rejectBtn:    { backgroundColor: '#DC2626' },
  actionText:   { color: '#FFF', fontWeight: '700', fontSize: 13 },

  emptyBox:  { alignItems: 'center', padding: 32, gap: 8 },
  emptyText: { fontSize: 13, color: '#94A3B8' },

  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
});
