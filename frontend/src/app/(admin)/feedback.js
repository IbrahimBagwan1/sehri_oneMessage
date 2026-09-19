import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { feedbackApi } from '../../api/feedback';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

const CATEGORY = {
  suggestion:   { label: 'Suggestion',   tone: 'teal',    icon: 'bulb-outline'    },
  complaint:    { label: 'Complaint',    tone: 'danger',  icon: 'warning-outline' },
  bug:          { label: 'Bug',          tone: 'gold',    icon: 'bug-outline'     },
  appreciation: { label: 'Appreciation', tone: 'success', icon: 'heart-outline'   },
  other:        { label: 'Other',        tone: 'neutral', icon: 'chatbox-outline' },
};

const FILTERS = [
  { key: 'unread', label: 'Unread' },
  { key: 'all',    label: 'All'    },
];

const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function AdminFeedbackScreen() {
  const [filter,     setFilter]     = useState('unread');
  const [items,      setItems]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const params = filter === 'unread' ? { is_read: false } : {};
      const res = await feedbackApi.list(params);
      if (res.success) setItems(res.data.feedback || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load feedback.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleMark = async (id) => {
    try {
      await feedbackApi.markRead(id);
      setItems((prev) => prev.map((f) => f.id === id ? { ...f, is_read: true } : f));
    } catch (err) {
      Alert.alert("Couldn't mark as read", err?.response?.data?.message || 'Try again.');
    }
  };

  const renderItem = ({ item }) => {
    const cfg = CATEGORY[item.category] || CATEGORY.other;
    const isUnread = !item.is_read;

    return (
      <Card style={isUnread ? styles.cardUnread : undefined}>
        <View style={styles.head}>
          <Chip label={cfg.label} tone={cfg.tone} icon={cfg.icon} />
          {isUnread && <View style={styles.unreadDot} />}
        </View>

        <Text style={styles.message}>{item.message}</Text>

        <View style={styles.who}>
          <Avatar name={item.user?.name} size={28} />
          <View style={{ flex: 1 }}>
            <Text style={styles.whoName}>{item.user?.name || 'Unknown'}</Text>
            {item.user?.phone ? <Text style={styles.whoPhone}>{item.user.phone}</Text> : null}
          </View>
          <Text style={styles.when}>{formatWhen(item.created_at)}</Text>
        </View>

        {isUnread && (
          <View style={styles.footer}>
            <Button
              label="Mark as read"
              onPress={() => handleMark(item.id)}
              variant="ghost"
              size="sm"
              icon="checkmark"
            />
          </View>
        )}
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Feedback"
        trailing={
          <Pressable onPress={() => load(true)} hitSlop={8} accessibilityLabel="Refresh">
            <Ionicons name="refresh" size={22} color={colors.teal} />
          </Pressable>
        }
      />

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            tone={filter === f.key ? 'teal' : 'neutral'}
            selected={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </View>

      {loading ? (
        <LoadingState message="Loading feedback…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="chatbubble-outline"
              title={filter === 'unread' ? 'No unread feedback' : 'No feedback yet'}
              message={
                filter === 'unread'
                  ? "You're all caught up on feedback from your zone."
                  : "Feedback from users in your zone will appear here."
              }
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  filterRow: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3] },

  list: { padding: space[4], paddingBottom: space[8] },

  cardUnread: { borderLeftWidth: 3, borderLeftColor: colors.teal },

  head:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space[3] },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal },

  message: { ...type.body, color: colors.ink, marginBottom: space[3] },

  who:       { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  whoName:   { ...type.metaStrong },
  whoPhone:  { ...type.micro, color: colors.inkFaint, marginTop: 2 },
  when:      { ...type.micro, color: colors.inkGhost },

  footer: {
    marginTop: space[3],
    paddingTop: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
    alignItems: 'flex-start',
  },
});
