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
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { adminApi } from '../../api/admin';

// Filter tabs
const TABS = [
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_CONFIG = {
  pending:  { color: '#D97706', bg: '#FEF3C7' },
  approved: { color: '#16A34A', bg: '#DCFCE7' },
  rejected: { color: '#DC2626', bg: '#FEE2E2' },
};

// Resolve zone name from the nested location chain
const resolveZoneName = (location) => {
  let current = location;
  let hops = 0;
  while (current && current.type !== 'zone' && hops < 10) {
    current = current.parent || null;
    hops++;
  }
  return current?.type === 'zone' ? current.name : null;
};

export default function AdminUsersScreen() {
  const [activeTab,   setActiveTab]   = useState('pending');
  const [users,       setUsers]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [actioningId, setActioningId] = useState(null); // id of user being approved/rejected

  // ---------------------------------------------------------------------------
  // Fetch users for the active tab
  // ---------------------------------------------------------------------------
  const fetchUsers = useCallback(async (tab = activeTab, isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const result = await adminApi.getUsers(tab);
      if (result.success) setUsers(result.data);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Could not load users.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab]);

  useFocusEffect(
    useCallback(() => {
      fetchUsers(activeTab);
    }, [activeTab])
  );

  // ---------------------------------------------------------------------------
  // Approve / Reject handler
  // ---------------------------------------------------------------------------
  const handleAction = async (userId, status, userName) => {
    Alert.alert(
      `${status === 'approved' ? 'Approve' : 'Reject'} User`,
      `Are you sure you want to ${status} ${userName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: status === 'approved' ? 'Approve' : 'Reject',
          style: status === 'rejected' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              setActioningId(userId);
              await adminApi.updateUserStatus(userId, status);
              // Remove from list immediately for snappy UX
              setUsers((prev) => prev.filter((u) => u.id !== userId));
            } catch (err) {
              Alert.alert('Error', err.response?.data?.message || 'Action failed.');
            } finally {
              setActioningId(null);
            }
          },
        },
      ]
    );
  };

  // ---------------------------------------------------------------------------
  // Render a single user card
  // ---------------------------------------------------------------------------
  const renderUser = ({ item }) => {
    const zoneName   = resolveZoneName(item.location);
    const statusCfg  = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    const isActioning = actioningId === item.id;

    return (
      <View style={styles.userCard}>
        {/* Top row: name + status badge */}
        <View style={styles.userCardTop}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {item.name?.charAt(0).toUpperCase() || '?'}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{item.name}</Text>
            <Text style={styles.userPhone}>{item.phone}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
            <Text style={[styles.statusText, { color: statusCfg.color }]}>
              {item.status}
            </Text>
          </View>
        </View>

        {/* Details row */}
        <View style={styles.detailsRow}>
          {zoneName && (
            <View style={styles.detailChip}>
              <Ionicons name="location-outline" size={12} color="#64748B" />
              <Text style={styles.detailChipText}>{zoneName}</Text>
            </View>
          )}
          {item.gender && (
            <View style={styles.detailChip}>
              <Ionicons name="person-outline" size={12} color="#64748B" />
              <Text style={styles.detailChipText}>{item.gender}</Text>
            </View>
          )}
          {item.occupation && (
            <View style={styles.detailChip}>
              <Ionicons name="briefcase-outline" size={12} color="#64748B" />
              <Text style={styles.detailChipText}>{item.occupation}</Text>
            </View>
          )}
        </View>

        {item.address ? (
          <Text style={styles.userAddress} numberOfLines={1}>
            <Ionicons name="home-outline" size={12} color="#94A3B8" /> {item.address}
          </Text>
        ) : null}

        {/* Action buttons — only shown for pending users */}
        {item.status === 'pending' && (
          <View style={styles.actionRow}>
            {isActioning ? (
              <ActivityIndicator color="#2563EB" style={{ marginVertical: 8 }} />
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.approveBtn]}
                  onPress={() => handleAction(item.id, 'approved', item.name)}
                >
                  <Ionicons name="checkmark" size={16} color="#FFF" />
                  <Text style={styles.actionBtnText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.rejectBtn]}
                  onPress={() => handleAction(item.id, 'rejected', item.name)}
                >
                  <Ionicons name="close" size={16} color="#FFF" />
                  <Text style={styles.actionBtnText}>Reject</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Users</Text>
        <TouchableOpacity onPress={() => fetchUsers(activeTab, true)}>
          <Ionicons name="refresh-outline" size={22} color="#2563EB" />
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={styles.tabRow}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={renderUser}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchUsers(activeTab, true)}
              colors={['#2563EB']}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="people-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyText}>No {activeTab} users</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#F8FAFC' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#0F172A' },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive:     { borderBottomColor: '#2563EB' },
  tabText:       { fontSize: 14, fontWeight: '600', color: '#94A3B8' },
  tabTextActive: { color: '#2563EB' },

  listContent: { padding: 16, paddingBottom: 30 },

  // User card
  userCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  userCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#DBEAFE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText:  { fontSize: 18, fontWeight: '700', color: '#2563EB' },
  userInfo:    { flex: 1 },
  userName:    { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  userPhone:   { fontSize: 13, color: '#64748B', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText:  { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },

  // Details
  detailsRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  detailChipText: { fontSize: 12, color: '#475569', textTransform: 'capitalize' },
  userAddress:    { fontSize: 12, color: '#94A3B8', marginTop: 2, marginBottom: 6 },

  // Action buttons
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  approveBtn:     { backgroundColor: '#16A34A' },
  rejectBtn:      { backgroundColor: '#DC2626' },
  actionBtnText:  { color: '#FFF', fontSize: 14, fontWeight: '600' },

  // States
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, color: '#94A3B8', marginTop: 12 },
});
