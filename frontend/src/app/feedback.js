import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { feedbackApi } from '../api/feedback';

// -----------------------------------------------------------------------------
// User-side feedback screen — submit form + history of your own submissions.
// Reached from the profile screen ("Send feedback" row).
// -----------------------------------------------------------------------------
const CATEGORIES = [
  { key: 'suggestion',   label: 'Suggestion',   icon: 'bulb-outline'    },
  { key: 'complaint',    label: 'Complaint',    icon: 'warning-outline' },
  { key: 'bug',          label: 'Bug',          icon: 'bug-outline'     },
  { key: 'appreciation', label: 'Appreciation', icon: 'heart-outline'   },
  { key: 'other',        label: 'Other',        icon: 'chatbox-outline' },
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
const MAX_MESSAGE = 2000;

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function UserFeedbackScreen() {
  const router = useRouter();

  const [category,   setCategory]   = useState('suggestion');
  const [message,    setMessage]    = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [history,    setHistory]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await feedbackApi.getMy({ page: 1, limit: 20 });
      if (res.success) setHistory(res.data.feedback || []);
    } catch (err) {
      // Non-fatal — form still works
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchHistory(); }, [fetchHistory]));

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      Alert.alert('Missing message', 'Please describe your feedback.');
      return;
    }

    setSubmitting(true);
    try {
      await feedbackApi.submit({ category, message: trimmed });
      Alert.alert('Thank you!', 'Your feedback has been submitted.');
      setMessage('');
      setCategory('suggestion');
      fetchHistory();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to submit feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#1F2937" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Feedback</Text>
          <View style={{ width: 30 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchHistory(true)}
              colors={['#0D9488']}
            />
          }
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Send us feedback</Text>
            <Text style={styles.cardSubtitle}>
              Suggestions, bugs, or a note of thanks — your zone admin will see it.
            </Text>

            <Text style={styles.label}>Category</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.categoryChip, category === c.key && styles.categoryChipActive]}
                  onPress={() => setCategory(c.key)}
                >
                  <Ionicons
                    name={c.icon}
                    size={13}
                    color={category === c.key ? '#FFF' : '#475569'}
                  />
                  <Text
                    style={[
                      styles.categoryChipText,
                      category === c.key && styles.categoryChipTextActive,
                    ]}
                  >
                    {c.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Message</Text>
            <TextInput
              style={styles.textArea}
              value={message}
              onChangeText={setMessage}
              placeholder="Type your feedback here…"
              placeholderTextColor="#94A3B8"
              multiline
              maxLength={MAX_MESSAGE}
              textAlignVertical="top"
            />
            <Text style={styles.counter}>{message.length} / {MAX_MESSAGE}</Text>

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="send-outline" size={16} color="#FFF" />
                  <Text style={styles.submitBtnText}>Send feedback</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>Your feedback history</Text>

          {loading ? (
            <ActivityIndicator color="#0D9488" style={{ marginVertical: 20 }} />
          ) : history.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="chatbubble-outline" size={36} color="#CBD5E1" />
              <Text style={styles.emptyText}>No feedback submitted yet.</Text>
            </View>
          ) : (
            history.map((f) => (
              <View key={f.id} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyCategory}>{CATEGORY_LABELS[f.category] || f.category}</Text>
                  {f.is_read ? (
                    <View style={styles.readBadge}>
                      <Ionicons name="checkmark-done" size={11} color="#16A34A" />
                      <Text style={styles.readText}>Seen by admin</Text>
                    </View>
                  ) : (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadText}>Awaiting review</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.historyMessage}>{f.message}</Text>
                <Text style={styles.historyDate}>{formatDate(f.created_at)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle:    { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  backBtn:        { padding: 4 },
  scrollContent:  { padding: 16, paddingBottom: 30 },

  card: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  cardTitle:      { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  cardSubtitle:   { fontSize: 13, color: '#64748B', marginTop: 4, marginBottom: 8 },
  label:          { fontSize: 13, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 8 },

  categoryRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  categoryChipActive:      { backgroundColor: '#0D9488' },
  categoryChipText:        { fontSize: 12, fontWeight: '600', color: '#475569' },
  categoryChipTextActive:  { color: '#FFF' },

  textArea: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 12,
    minHeight: 120,
    fontSize: 15,
    color: '#0F172A',
  },
  counter:        { fontSize: 11, color: '#94A3B8', textAlign: 'right', marginTop: 4 },

  submitBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0D9488',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
    minHeight: 46,
  },
  buttonDisabled: { opacity: 0.6 },
  submitBtnText:  { color: '#FFF', fontSize: 15, fontWeight: '700' },

  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  historyCard: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
  },
  historyHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  historyCategory: { fontSize: 12, color: '#0D9488', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  historyMessage:  { fontSize: 14, color: '#0F172A', lineHeight: 20 },
  historyDate:     { fontSize: 11, color: '#94A3B8', marginTop: 6 },
  readBadge:       { flexDirection: 'row', gap: 3, alignItems: 'center', backgroundColor: '#DCFCE7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  readText:        { fontSize: 10, color: '#16A34A', fontWeight: '700' },
  unreadBadge:     { backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  unreadText:      { fontSize: 10, color: '#92400E', fontWeight: '700' },

  emptyBox:  { alignItems: 'center', padding: 24, backgroundColor: '#FFF', borderRadius: 12 },
  emptyText: { fontSize: 13, color: '#94A3B8', marginTop: 8 },
});
