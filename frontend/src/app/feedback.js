import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { feedbackApi } from '../api/feedback';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Header,
  Input,
  LoadingState,
  SectionHeader,
  KeyboardAwareScroll
} from '../components/ui';
import { colors, space, type } from '../theme';

const CATEGORIES = [
  { key: 'suggestion',   label: 'Suggestion',   icon: 'bulb-outline'    },
  { key: 'complaint',    label: 'Complaint',    icon: 'warning-outline' },
  { key: 'bug',          label: 'Bug',          icon: 'bug-outline'     },
  { key: 'appreciation', label: 'Appreciation', icon: 'heart-outline'   },
  { key: 'other',        label: 'Other',        icon: 'chatbox-outline' },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export default function UserFeedbackScreen() {
  const router = useRouter();

  const [category, setCategory]     = useState('suggestion');
  const [message, setMessage]       = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [history, setHistory]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await feedbackApi.getMy({ page: 1, limit: 20 });
      if (res.success) setHistory(res.data.feedback || []);
    } catch {
      // silent — form still works
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchHistory(); }, [fetchHistory]));

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed) return Alert.alert('Missing message', 'Describe your feedback before submitting.');
    setSubmitting(true);
    try {
      await feedbackApi.submit({ category, message: trimmed });
      Alert.alert('Thank you', 'Your feedback has been submitted.');
      setMessage('');
      setCategory('suggestion');
      fetchHistory();
    } catch (err) {
      Alert.alert("Couldn't submit feedback", err?.response?.data?.message || 'Try again in a moment.');
    } finally { setSubmitting(false); }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Feedback" onBack={() => router.back()} />
      <KeyboardAwareScroll
        contentContainerStyle={styles.scroll}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchHistory(true)}
            colors={[colors.teal]}
            tintColor={colors.teal}
          />
        )}
      >
          <SectionHeader title="Send us feedback" subtitle="Your zone admin will read it." />
          <Card>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chipRow}>
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.key}
                  label={c.label}
                  icon={c.icon}
                  tone={category === c.key ? 'teal' : 'neutral'}
                  selected={category === c.key}
                  onPress={() => setCategory(c.key)}
                />
              ))}
            </View>

            <Text style={[styles.label, { marginTop: space[4] }]}>Message</Text>
            <Input
              value={message}
              onChangeText={setMessage}
              placeholder="Type your feedback here…"
              multiline
              maxLength={2000}
            />
            <Text style={styles.counter}>{message.length} / 2000</Text>

            <Button
              label="Send feedback"
              onPress={handleSubmit}
              loading={submitting}
              fullWidth
              icon="send-outline"
              style={{ marginTop: space[3] }}
            />
          </Card>

          <View style={{ marginTop: space[6] }}>
            <SectionHeader title="Your history" />
            {loading ? (
              <Card><LoadingState message="Loading your history…" compact /></Card>
            ) : history.length === 0 ? (
              <Card>
                <EmptyState
                  icon="chatbubble-outline"
                  title="No feedback yet"
                  message="Anything you send will show up here so you can track it."
                />
              </Card>
            ) : (
              <View style={{ gap: space[2] }}>
                {history.map((f) => (
                  <Card key={f.id}>
                    <View style={styles.itemHead}>
                      <Text style={styles.itemCategory}>{CATEGORY_LABEL[f.category] || f.category}</Text>
                      <Chip
                        label={f.is_read ? 'Seen by admin' : 'Awaiting review'}
                        tone={f.is_read ? 'success' : 'warn'}
                      />
                    </View>
                    <Text style={styles.itemMessage}>{f.message}</Text>
                    <Text style={styles.itemDate}>{formatDate(f.created_at)}</Text>
                  </Card>
                ))}
              </View>
            )}
          </View>
      </KeyboardAwareScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { padding: space[4], paddingBottom: space[8] },

  label:   { ...type.meta, color: colors.inkMuted, fontWeight: '600', marginBottom: space[2] },
  chipRow: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  counter: { ...type.micro, color: colors.inkGhost, textAlign: 'right', marginTop: space[1] },

  itemHead:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[2] },
  itemCategory: { ...type.metaStrong, color: colors.teal },
  itemMessage:  { ...type.body, color: colors.ink },
  itemDate:     { ...type.micro, color: colors.inkGhost, marginTop: space[2] },
});
