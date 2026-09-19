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
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { donationsApi } from '../../api/donations';

const STATUS_CONFIG = {
  pending:  { label: 'Pending',  color: '#D97706', bg: '#FEF3C7', icon: 'hourglass-outline' },
  verified: { label: 'Verified', color: '#16A34A', bg: '#DCFCE7', icon: 'checkmark-circle' },
  rejected: { label: 'Rejected', color: '#DC2626', bg: '#FEE2E2', icon: 'close-circle' },
};

const QUICK_AMOUNTS = [100, 500, 1000, 2000];

const formatINR = (val) => {
  const n = Number.parseFloat(val);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const formatDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function DonateScreen() {
  const [amount, setAmount]   = useState('');
  const [note, setNote]       = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [history, setHistory]         = useState([]);
  const [loadingHistory, setLoading]  = useState(true);
  const [refreshing, setRefreshing]   = useState(false);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await donationsApi.getHistory({ page: 1, limit: 20 });
      if (res.success) setHistory(res.data.donations || []);
    } catch (err) {
      // Non-fatal — silent so submit still works if history endpoint hiccups
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchHistory(); }, [fetchHistory]));

  const totalVerified = history
    .filter((d) => d.status === 'verified')
    .reduce((sum, d) => sum + Number.parseFloat(d.amount || 0), 0);

  const handleSubmit = async () => {
    const numeric = Number.parseFloat(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      Alert.alert('Invalid amount', 'Please enter an amount greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      await donationsApi.submit({ amount: numeric, note: note.trim() || undefined });
      Alert.alert('Thank you!', 'Your donation has been submitted for verification.');
      setAmount('');
      setNote('');
      fetchHistory();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to submit donation.';
      Alert.alert('Error', msg);
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
          <Text style={styles.headerTitle}>Donate</Text>
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
          {/* Total contributed */}
          <View style={styles.summaryCard}>
            <Ionicons name="heart" size={22} color="#DC2626" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.summaryLabel}>Total contributed</Text>
              <Text style={styles.summaryAmount}>{formatINR(totalVerified)}</Text>
            </View>
          </View>

          {/* Submit form */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Make a donation</Text>

            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
              placeholder="Enter amount"
              placeholderTextColor="#94A3B8"
              keyboardType="decimal-pad"
              returnKeyType="done"
            />

            <View style={styles.quickRow}>
              {QUICK_AMOUNTS.map((v) => (
                <TouchableOpacity
                  key={v}
                  style={styles.quickBtn}
                  onPress={() => setAmount(String(v))}
                >
                  <Text style={styles.quickBtnText}>₹{v}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. UPI reference, in memory of, etc."
              placeholderTextColor="#94A3B8"
              multiline
              maxLength={500}
            />

            <TouchableOpacity
              style={[styles.submitButton, submitting && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#FFF" />
                  <Text style={styles.submitButtonText}>Submit for verification</Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.footnote}>
              A zone admin will verify your donation. You'll see the status update below.
            </Text>
          </View>

          {/* History */}
          <Text style={styles.sectionTitle}>Your donations</Text>

          {loadingHistory ? (
            <ActivityIndicator color="#0D9488" style={{ marginVertical: 20 }} />
          ) : history.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="wallet-outline" size={36} color="#CBD5E1" />
              <Text style={styles.emptyText}>No donations yet.</Text>
            </View>
          ) : (
            history.map((d) => {
              const cfg = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending;
              return (
                <View key={d.id} style={styles.historyCard}>
                  <View style={styles.historyRow}>
                    <Text style={styles.historyAmount}>{formatINR(d.amount)}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                      <Ionicons name={cfg.icon} size={12} color={cfg.color} />
                      <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                  {d.note ? <Text style={styles.historyNote}>{d.note}</Text> : null}
                  <Text style={styles.historyDate}>{formatDateTime(d.created_at)}</Text>
                </View>
              );
            })
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
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle:    { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  scrollContent:  { padding: 16, paddingBottom: 30 },

  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  summaryLabel:   { fontSize: 12, color: '#7F1D1D', fontWeight: '600', textTransform: 'uppercase' },
  summaryAmount:  { fontSize: 22, fontWeight: '800', color: '#B91C1C', marginTop: 2 },

  card: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  cardTitle:      { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 12 },
  label:          { fontSize: 13, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0F172A',
  },
  quickRow:       { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  quickBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F0FDF9',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  quickBtnText:   { fontSize: 13, fontWeight: '600', color: '#0F766E' },

  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0D9488',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 20,
    minHeight: 48,
  },
  buttonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  footnote:       { fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 10 },

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
  historyRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyAmount:  { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  historyNote:    { fontSize: 13, color: '#475569', marginTop: 4 },
  historyDate:    { fontSize: 11, color: '#94A3B8', marginTop: 4 },
  statusBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusText:     { fontSize: 11, fontWeight: '700' },

  emptyBox:       { alignItems: 'center', padding: 24, backgroundColor: '#FFF', borderRadius: 12 },
  emptyText:      { fontSize: 13, color: '#94A3B8', marginTop: 8 },
});
