import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { chatApi } from '../../api/chat';
import { useAuthStore } from '../../store/useAuthStore';
import {
  EmptyState,
  ErrorState,
  GuestGate,
  Header,
  LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// User chat tab — list of groups the signed-in user is a member of.
// Same data source as the admin/super-admin lists (/api/chat/groups).
// Guests see the sign-in gate (chat is member-only).
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

export default function UserChatScreen() {
  const isGuest = useAuthStore((s) => s.isGuest);
  if (isGuest) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Chat" />
        <GuestGate
          icon="chatbubbles-outline"
          title="Chat is for members"
          message="Sign in to read and post in your community's chat groups."
        />
      </SafeAreaView>
    );
  }
  return <UserChatScreenAuthed />;
}

function UserChatScreenAuthed() {
  const router = useRouter();
  const [groups,     setGroups]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

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

  const renderGroup = ({ item }) => {
    const previewSender = item.latest_message?.sender?.name;
    const previewText = item.latest_message?.is_deleted
      ? 'This message was deleted'
      : item.latest_message?.content;

    return (
      <Pressable
        onPress={() => router.push({ pathname: '/chat-room', params: { id: item.id, name: item.name } })}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}${item.unread_count ? `, ${item.unread_count} unread` : ''}`}
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
            <Text style={[styles.groupPreview, { fontStyle: 'italic' }]} numberOfLines={1}>
              No messages yet
            </Text>
          )}
        </View>
        {item.unread_count > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Chat" />

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
              message="Once the super admin adds you to a chat group, you'll see it here."
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

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
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

  groupHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  groupName:  { ...type.h3, flex: 1, marginRight: space[2] },
  groupTime:  { ...type.micro, color: colors.inkGhost },

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
});
