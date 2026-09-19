import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { feedbackApi } from '../../api/feedback';

// -----------------------------------------------------------------------------
// The zone-admin feedback screen. Backend scopes results to the admin's own
// zone via zone_location_id on the JWT, so no client-side filtering is
// required beyond what the user asks for (unread / all).
// -----------------------------------------------------------------------------
const CATEGORY_CONFIG = {
  suggestion:   { label: 'Suggestion',   color: '#0369A1', bg: '#E0F2FE', icon: 'bulb-outline' },
  complaint:    { label: 'Complaint',    color: '#DC2626', bg: '#FEE2E2', icon: 'warning-outline' },
  bug:          { label: 'Bug',          color: '#7C3AED', bg: '#EDE9FE', icon: 'bug-outline' },
  appreciation: { label: 'Appreciation', color: '#16A34A', bg: '#DCFCE7', icon: 'heart-outline' },
  other:        { label: 'Other',        color: '#64748B', bg: '#F1F5F9', icon: 'chatbox-outline' },
};

const FILTERS = [
  { key: 'all',    label: 'All'    },
  { key: 'unread', label: 'Unread' },
];

const formatDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function AdminFeedbackScreen() {
  const [filter,     setFilter]     = useState('unread');
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const params = filter === 'unread' ? { is_read: false } : {};
      const res = await feedbackApi.list(params);
      if (res.success) setItems(res.data.feedback || []);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to load feedback');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleMarkRead = async (id) => {
    try {
      await feedbackApi.markRead(id);
      setItems((prev) => prev.map((f) => f.id === id ? { ...f, is_read: true } : f));
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Could not mark as read');
    }
  };

  const renderItem = ({ item }) => {
    const cfg = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.other;
    const isUnread = !item.is_read;

    return (
      <View style={[styles.card, isUnread && styles.cardUnread]}>
        <View style={styles.cardHeader}>
          <View style={[styles.categoryBadge, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon} size={12} color={cfg.color} />
            <Text style={[styles.categoryText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
          {isUnread && <View style={styles.unreadDot} />}
        </View>
        <Text style={styles.message}>{item.message}</Text>
        <View style={styles.meta}>
          <Ionicons name="person-outline" size={12} color="#94A3B8" />
          <Text style={styles.metaText}>
            {item.user?.name || 'Unknown'}{item.user?.phone ? ` · ${item.user.phone}` : ''}
          </Text>
        </View>
        <View style={styles.footer}>
          <Text style={styles.dateText}>{formatDateTime(item.created_at)}</Text>
          {isUnread && (
            <TouchableOpacity style={styles.markReadBtn} onPress={() => handleMarkRead(item.id)}>
              <Ionicons name="checkmark" size={14} color="#0D9488" />
              <Text style={styles.markReadText}>Mark read</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Feedback</Text>
        <TouchableOpacity onPress={() => load(true)} style={styles.iconBtn}>
          <Ionicons name="refresh" size={20} color="#0D9488" />
        </TouchableOpacity>
      </View>

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
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
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
              <Ionicons name="chatbubble-outline" size={40} color="#CBD5E1" />
              <Text style={styles.emptyText}>
                {filter === 'unread' ? 'No unread feedback in your zone.' : 'No feedback yet.'}
              </Text>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
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
  cardUnread:    { borderLeftWidth: 3, borderLeftColor: '#0D9488' },
  cardHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  categoryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  categoryText:  { fontSize: 11, fontWeight: '700' },
  unreadDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#0D9488' },
  message:       { fontSize: 14, color: '#0F172A', lineHeight: 20, marginBottom: 8 },
  meta:          { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  metaText:      { fontSize: 12, color: '#64748B' },
  footer:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 8 },
  dateText:      { fontSize: 11, color: '#94A3B8' },
  markReadBtn:   { flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: '#F0FDF9' },
  markReadText:  { fontSize: 12, color: '#0D9488', fontWeight: '700' },

  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  emptyText: { fontSize: 13, color: '#94A3B8', textAlign: 'center' },
});
