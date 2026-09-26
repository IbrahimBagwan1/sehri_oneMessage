import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { chatApi } from '../api/chat';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
} from '../components/ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// Blocked people — the undo for a block.
//
// A block made in the moment, at night, after reading something upsetting,
// should not be permanent by accident. Both stores expect blocking to be
// reversible, and more to the point a community this size has to be able to
// take something back.
//
// The copy is deliberate about what a block does and does not do, because
// that is the most common misunderstanding: it hides their messages from
// you, it does not hide yours from them, and it does not remove them from
// the group.
// -----------------------------------------------------------------------------

export default function BlockedUsersScreen() {
  const router = useRouter();

  const [blocked, setBlocked]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [busyKey, setBusyKey]       = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await chatApi.getBlockedUsers();
      if (res.success) setBlocked(res.data.blocked || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load your blocked list.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleUnblock = (person) => {
    Alert.alert(
      `Unblock ${person.name}?`,
      "You'll start seeing their messages again, including the ones sent while "
      + 'they were blocked. Nothing was deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            const key = `${person.user_type}:${person.user_id}`;
            setBusyKey(key);
            try {
              await chatApi.unblockUser(person.user_id, person.user_type);
              setBlocked((prev) => prev.filter(
                (b) => !(b.user_id === person.user_id && b.user_type === person.user_type)
              ));
            } catch (err) {
              Alert.alert("Couldn't unblock", err?.response?.data?.message || 'Try again.');
            } finally {
              setBusyKey(null);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Blocked people" onBack={() => router.back()} />

      {loading ? (
        <LoadingState message="Loading…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : blocked.length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="You haven't blocked anyone"
          message="If someone's messages are a problem, press and hold one in any group chat to block or report them."
        />
      ) : (
        <FlatList
          data={blocked}
          keyExtractor={(b) => `${b.user_type}:${b.user_id}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.teal]}
              tintColor={colors.teal}
            />
          }
          ListHeaderComponent={
            <Card style={styles.explainer}>
              <Text style={styles.explainerText}>
                You don&apos;t see messages from these people in any group. They can
                still see yours, they stay in the group, and they were never told.
              </Text>
            </Card>
          }
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          renderItem={({ item }) => {
            const key = `${item.user_type}:${item.user_id}`;
            const busy = busyKey === key;
            return (
              <Card>
                <View style={styles.row}>
                  <Avatar name={item.name} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.meta}>
                      {item.is_former_member
                        ? 'This account no longer exists'
                        : `Blocked ${formatWhen(item.blocked_at)}`}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleUnblock(item)}
                    disabled={busy}
                    style={({ pressed }) => [styles.unblockBtn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Unblock ${item.name}`}
                    hitSlop={6}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.teal} />
                    ) : (
                      <Text style={styles.unblockText}>Unblock</Text>
                    )}
                  </Pressable>
                </View>
              </Card>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

// "on 12 Sep" / "today" — a blocked list does not need a clock time.
function formatWhen(iso) {
  if (!iso) return 'a while ago';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'today';
  return `on ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  list:   { padding: space[4], paddingBottom: space[10] },

  explainer:     { marginBottom: space[3], backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  explainerText: { ...type.meta, color: colors.tealDark },

  row:  { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  name: { ...type.bodyStrong },
  meta: { ...type.meta, marginTop: 2 },

  unblockBtn: {
    minHeight: 40, minWidth: 80,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.tealBorder,
    backgroundColor: colors.tealSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  unblockText: { ...type.metaStrong, color: colors.tealDark },
  pressed:     { opacity: 0.6 },
});
