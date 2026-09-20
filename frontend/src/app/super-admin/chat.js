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
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { chatApi } from '../../api/chat';
import {
  Button,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Super admin — group list. Backed by the real /api/chat/groups endpoint.
// Delete + full member management is one tap deeper (a follow-up screen);
// this list view is the daily-driver landing page.
// -----------------------------------------------------------------------------

const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export default function SuperAdminChatScreen() {
  const router = useRouter();
  const [groups, setGroups]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [deleting, setDeleting]     = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await chatApi.getMyGroups();
      if (res.success) setGroups(res.data.groups || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load your groups.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDelete = (id, name) => {
    Alert.alert(
      `Delete ${name}?`,
      "Members will lose access. Messages stay in the audit log but nobody can post to the group anymore.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(id);
            try {
              await chatApi.deleteGroup(id);
              setGroups((prev) => prev.filter((g) => g.id !== id));
            } catch (err) {
              Alert.alert("Couldn't delete", err?.response?.data?.message || 'Try again.');
            } finally {
              setDeleting(null);
            }
          },
        },
      ]
    );
  };

  const renderGroup = ({ item }) => {
    const previewSender = item.latest_message?.sender?.name;
    const previewText = item.latest_message?.is_deleted
      ? 'This message was deleted'
      : item.latest_message?.content;

    return (
      <View style={styles.rowWrap}>
        <Pressable
          onPress={() => router.push({ pathname: '/chat-room', params: { id: item.id, name: item.name } })}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={item.name}
        >
          <View style={styles.groupIcon}>
            <Ionicons name="chatbubbles-outline" size={20} color={colors.tealDark} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.groupHead}>
              <Text style={styles.groupName} numberOfLines={1}>{item.name}</Text>
              {item.latest_message?.created_at ? (
                <Text style={styles.groupTime}>{formatWhen(item.latest_message.created_at)}</Text>
              ) : null}
            </View>
            {previewText ? (
              <Text style={styles.groupPreview} numberOfLines={1}>
                {previewSender ? <Text style={styles.groupSender}>{previewSender}: </Text> : null}
                {previewText}
              </Text>
            ) : (
              <Text style={[styles.groupPreview, { fontStyle: 'italic' }]}>No messages yet</Text>
            )}
          </View>
          {item.unread_count > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => handleDelete(item.id, item.name)}
          hitSlop={8}
          style={styles.deleteBtn}
          accessibilityLabel={`Delete ${item.name}`}
        >
          <Ionicons name="trash-outline" size={18} color={deleting === item.id ? colors.inkGhost : colors.danger} />
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Group chat"
        onBack={() => router.back()}
        trailing={
          <Pressable onPress={() => router.push('/chat-create-group')} hitSlop={8} accessibilityLabel="Create group">
            <Ionicons name="add" size={24} color={colors.teal} />
          </Pressable>
        }
      />

      {loading ? (
        <LoadingState message="Loading your groups…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          renderItem={renderGroup}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={groups.length === 0 ? { flexGrow: 1 } : styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="chatbubbles-outline"
              title="No groups yet"
              message="Create your first group to broadcast to admins or a subset of the community."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },

  list: { paddingBottom: space[8] },
  separator: { height: 1, backgroundColor: colors.ruleFaint, marginLeft: 64 },

  rowWrap: { flexDirection: 'row', alignItems: 'stretch' },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingLeft: space[4],
    paddingRight: space[2],
    paddingVertical: space[3],
    backgroundColor: colors.paper,
  },
  rowPressed: { backgroundColor: colors.tealSoft },

  groupIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center',
  },

  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  groupName: { ...type.h3, flex: 1, marginRight: space[2] },
  groupTime: { ...type.micro, color: colors.inkGhost },

  groupPreview: { ...type.meta, color: colors.inkFaint },
  groupSender:  { color: colors.inkMuted, fontWeight: '600' },

  badge: {
    backgroundColor: colors.teal,
    borderRadius: 10,
    minWidth: 20, height: 20,
    paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { ...type.micro, color: colors.paper, fontWeight: '800' },

  deleteBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: space[3],
    borderLeftWidth: 1,
    borderLeftColor: colors.ruleFaint,
  },
});
