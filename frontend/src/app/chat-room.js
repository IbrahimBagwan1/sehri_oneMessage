import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { chatApi } from '../api/chat';
import { useAuthStore } from '../store/useAuthStore';
import {
  Avatar,
  EmptyState,
  ErrorState,
  GuestGate,
  Header,
  LoadingState,
} from '../components/ui';
import { connect as connectSocket, getSocket } from '../services/socket';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// Chat room — real-time message thread.
//
// Data flow:
//   1. On mount, REST-fetch the last 30 messages (page 1) so the list has
//      content immediately.
//   2. Open the shared Socket.IO connection (if it's not open), then
//      emit 'join_group' with this group's id so the backend places us
//      in the group:{id} room.
//   3. Listen for 'new_message' and 'message_deleted' events emitted by
//      the backend controller after every REST send/delete.
//   4. On send, POST via REST — the backend echoes 'new_message' back to
//      the room; we dedupe locally by id so the sender doesn't see the
//      message twice.
//   5. On unmount, emit 'leave_group' and remove listeners.
//
// Guest wrapper — the outer component checks isGuest and returns
// GuestGate before rendering the real screen, so hooks stay disciplined.
// -----------------------------------------------------------------------------

export default function ChatRoomScreen() {
  const isGuest = useAuthStore((s) => s.isGuest);
  const router  = useRouter();
  const params  = useLocalSearchParams();
  const groupId   = String(params.id || '');
  const groupName = String(params.name || 'Chat');

  if (isGuest) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.paperSoft }} edges={['top', 'bottom']}>
        <Header title={groupName} onBack={() => router.back()} />
        <GuestGate
          icon="chatbubbles-outline"
          title="Chat is for members"
          message="Sign in to read and post in your community's chat groups."
        />
      </SafeAreaView>
    );
  }
  if (!groupId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.paperSoft }} edges={['top', 'bottom']}>
        <Header title="Chat" onBack={() => router.back()} />
        <ErrorState message="This chat link is missing a group id." onRetry={() => router.back()} retryLabel="Go back" />
      </SafeAreaView>
    );
  }
  return <ChatRoomAuthed groupId={groupId} groupName={groupName} onBack={() => router.back()} />;
}

function ChatRoomAuthed({ groupId, groupName, onBack }) {
  const user        = useAuthStore((s) => s.user);
  const active_role = useAuthStore((s) => s.active_role);
  const meId        = user?.id;

  const listRef = useRef(null);

  const [messages, setMessages] = useState([]);   // ordered oldest → newest
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [sending,  setSending]  = useState(false);
  const [draft,    setDraft]    = useState('');

  // --- Initial history + mark-as-read -------------------------------------
  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await chatApi.getMessages(groupId, { page: 1, limit: 50 });
      if (res.success) {
        // API returns newest-first; reverse for chronological display.
        const rows = [...(res.data.messages || [])].reverse();
        setMessages(rows);
        // Non-fatal — clear unread badge in the background.
        chatApi.markRead(groupId).catch(() => {});
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load messages.");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => { loadHistory(); }, [loadHistory]));

  // --- Socket subscription -----------------------------------------------
  useEffect(() => {
    let alive = true;
    let socketRef = null;

    (async () => {
      const s = await connectSocket();
      if (!alive || !s) return;
      socketRef = s;
      s.emit('join_group', { group_id: groupId });

      const onNew = (msg) => {
        if (!alive || !msg || msg.group_id !== groupId) return;
        // Dedupe — the sender already appended optimistically.
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        // Nudge scroll if the user is near the bottom.
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      };
      const onDeleted = (payload) => {
        if (!alive || !payload?.message_id) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === payload.message_id ? { ...m, is_deleted: true, content: null } : m))
        );
      };
      s.on('new_message', onNew);
      s.on('message_deleted', onDeleted);

      return () => {
        s.off('new_message', onNew);
        s.off('message_deleted', onDeleted);
      };
    })();

    return () => {
      alive = false;
      const s = socketRef || getSocket();
      if (s?.connected) s.emit('leave_group', { group_id: groupId });
    };
  }, [groupId]);

  // --- Send / delete -----------------------------------------------------
  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await chatApi.sendMessage(groupId, { content: text });
      if (res.success) {
        const msg = res.data;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        setDraft('');
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      }
    } catch (err) {
      Alert.alert("Couldn't send", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setSending(false);
    }
  };

  const canDelete = (msg) => {
    if (!msg || msg.is_deleted) return false;
    const iOwnIt = msg.sender?.id === meId;
    const iAmSuperAdmin = active_role === 'super_admin';
    return iOwnIt || iAmSuperAdmin;
  };

  const handleLongPress = (msg) => {
    if (!canDelete(msg)) return;
    Alert.alert(
      'Delete message?',
      "This can't be undone. Others will see 'This message was deleted.'",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await chatApi.deleteMessage(groupId, msg.id);
              setMessages((prev) =>
                prev.map((m) => (m.id === msg.id ? { ...m, is_deleted: true, content: null } : m))
              );
            } catch (err) {
              Alert.alert("Couldn't delete", err?.response?.data?.message || 'Try again.');
            }
          },
        },
      ]
    );
  };

  // --- Render ------------------------------------------------------------
  const renderMessage = ({ item, index }) => {
    const mine = item.sender?.id === meId;
    const prev = messages[index - 1];
    const showAvatar = !mine && (!prev || prev.sender?.id !== item.sender?.id);
    const showSenderName = !mine && showAvatar;

    return (
      <View style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}>
        {/* Their side — avatar column */}
        {!mine && (
          <View style={styles.avatarCol}>
            {showAvatar ? <Avatar name={item.sender?.name} size={28} /> : <View style={{ width: 28 }} />}
          </View>
        )}

        <Pressable
          onLongPress={() => handleLongPress(item)}
          delayLongPress={280}
          style={({ pressed }) => [
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            item.is_deleted && styles.bubbleDeleted,
            pressed && canDelete(item) && { opacity: 0.7 },
          ]}
          accessibilityLabel={
            item.is_deleted
              ? 'Deleted message'
              : `${item.sender?.name || 'Unknown'}: ${item.content}`
          }
        >
          {showSenderName && (
            <Text style={styles.senderName} numberOfLines={1}>{item.sender?.name}</Text>
          )}
          {item.is_deleted ? (
            <Text style={styles.deletedText}>This message was deleted</Text>
          ) : (
            <Text style={[styles.msgText, mine && styles.msgTextMine]}>{item.content}</Text>
          )}
          <Text style={[styles.timestamp, mine && styles.timestampMine]}>
            {formatTime(item.created_at)}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title={groupName} onBack={onBack} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={{ flex: 1 }}
      >
        {loading ? (
          <LoadingState message="Loading messages…" />
        ) : error ? (
          <ErrorState message={error} onRetry={loadHistory} />
        ) : messages.length === 0 ? (
          <EmptyState
            icon="chatbubble-outline"
            title="No messages yet"
            message="Be the first to say salaam."
          />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            initialNumToRender={30}
          />
        )}

        {/* Composer — matches the app's flat input style. */}
        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor={colors.inkGhost}
            multiline
            maxLength={2000}
            editable={!sending}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            style={({ pressed }) => [
              styles.sendBtn,
              (!draft.trim() || sending) && styles.sendBtnDisabled,
              pressed && !sending && draft.trim() && styles.sendBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.paper} />
            ) : (
              <Ionicons name="arrow-up" size={20} color={colors.paper} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// "10:24 am"
function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  list: {
    paddingHorizontal: space[3],
    paddingTop: space[3],
    paddingBottom: space[3],
  },

  msgRow: {
    flexDirection: 'row',
    marginBottom: space[2],
    alignItems: 'flex-end',
  },
  msgRowMine:   { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  avatarCol:    { width: 28, marginRight: space[2] },

  bubble: {
    maxWidth: '76%',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.lg,
  },
  bubbleMine: {
    backgroundColor: colors.teal,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    borderBottomLeftRadius: 4,
  },
  bubbleDeleted: { opacity: 0.65 },

  senderName: {
    ...type.micro,
    color: colors.tealDark,
    fontWeight: '700',
    marginBottom: 2,
  },
  msgText:      { fontSize: 15, lineHeight: 21, color: colors.ink },
  msgTextMine:  { color: colors.paper },
  deletedText:  { fontSize: 13, fontStyle: 'italic', color: colors.inkFaint },
  timestamp: {
    ...type.micro,
    color: colors.inkGhost,
    marginTop: 4,
    alignSelf: 'flex-end',
    fontVariant: ['tabular-nums'],
  },
  timestampMine: { color: 'rgba(255,255,255,0.85)' },

  // Composer
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    padding: space[3],
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
  },
  composerInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingHorizontal: space[3],
    paddingVertical: 10,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    backgroundColor: colors.paperSoft,
    fontSize: 15,
    color: colors.ink,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.teal,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnPressed:  { backgroundColor: colors.tealDark },
  sendBtnDisabled: { backgroundColor: colors.inkGhost, opacity: 0.55 },
});
