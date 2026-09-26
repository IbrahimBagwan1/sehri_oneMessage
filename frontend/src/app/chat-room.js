import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
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
  KeyboardAvoidingView
} from '../components/ui';
import { connect as connectSocket, getSocket } from '../services/socket';
import ReportMessageSheet from '../components/ReportMessageSheet';
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
// Blocking: message HISTORY is filtered server-side, so a blocked person's
// words never reach this device. A live socket broadcast goes to a room and
// has no per-recipient view, so the blocked list is fetched on mount and
// incoming messages are checked against it too. That second check is belt
// and braces — a client that skipped it still could not fetch the message
// back from history.
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
  // The socket handler is registered once; a state value captured in its
  // closure would go stale the moment someone blocks anyone. A ref keeps
  // the handler reading the current set without making the socket effect
  // depend on it and rebuild the connection on every change.
  const blockedRef = useRef(new Set());

  const [messages, setMessages] = useState([]);   // ordered oldest → newest
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [sending,  setSending]  = useState(false);
  const [draft,    setDraft]    = useState('');

  // Moderation state.
  //   blockedKeys  — "type:id" of everyone this member has blocked, used to
  //                   drop live socket messages (history is already filtered)
  //   reportTarget — the message the report sheet is open for, or null
  //   banInfo      — set when a moderator has closed the composer for us
  const [blockedKeys, setBlockedKeys] = useState(() => new Set());
  const [reportTarget, setReportTarget] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [banInfo, setBanInfo] = useState(null);

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

  // The blocked list, for filtering live socket traffic. Fetched alongside
  // history rather than inside the socket effect so a reconnect does not
  // re-request it.
  const loadBlocked = useCallback(async () => {
    try {
      const res = await chatApi.getBlockedUsers();
      if (res.success) {
        setBlockedKeys(new Set((res.data.blocked || []).map((b) => `${b.user_type}:${b.user_id}`)));
      }
    } catch {
      // Non-fatal. History is filtered server-side regardless; the worst
      // case is a blocked person's live message appearing until refresh.
    }
  }, []);

  // Am I banned from posting here? Read from this one group's details
  // rather than the whole group list — the list computes an unread count
  // and a preview message per group, which is a lot of work to find one
  // boolean on every time a room is opened.
  const loadBanState = useCallback(async () => {
    try {
      const res = await chatApi.getGroup(groupId);
      if (res.success) {
        const m = res.data?.my_membership;
        setBanInfo(m?.is_banned ? { reason: m.ban_reason } : null);
      }
    } catch {
      // Leave the composer open. A banned send returns 403 with a clear
      // message, so the worst case is one wasted attempt.
    }
  }, [groupId]);

  useFocusEffect(useCallback(() => {
    loadHistory();
    loadBlocked();
    loadBanState();
  }, [loadHistory, loadBlocked, loadBanState]));

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
        // A room broadcast reaches everyone in it, including people who
        // blocked the sender. Drop it here; history is filtered server-side.
        const senderKey = `${msg.sender?.role}:${msg.sender?.id}`;
        if (blockedRef.current.has(senderKey)) return;
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

  useEffect(() => { blockedRef.current = blockedKeys; }, [blockedKeys]);

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

  const isMine = (msg) => msg?.sender?.id === meId;

  // Long-press already existed on this screen, as a delete-only shortcut
  // that silently did nothing on anyone else's message. Rather than adding
  // a second interaction, it now opens the actions that apply to whichever
  // message was pressed — so the gesture people already know is the one
  // that reaches reporting.
  const handleLongPress = (msg) => {
    if (!msg || msg.is_deleted) return;

    const options = [];

    if (canDelete(msg)) {
      options.push({
        text: 'Delete message',
        style: 'destructive',
        onPress: () => confirmDelete(msg),
      });
    }

    // You cannot report or block yourself; both are refused server-side
    // too, but offering them would be a confusing thing to tap.
    if (!isMine(msg)) {
      options.push({ text: 'Report message', onPress: () => setReportTarget(msg) });
      options.push({
        text: `Block ${msg.sender?.name || 'this person'}`,
        style: 'destructive',
        onPress: () => confirmBlock(msg.sender),
      });
    }

    if (options.length === 0) return;
    options.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(
      msg.sender?.name || 'Message',
      truncate(msg.content, 100),
      options
    );
  };

  const confirmDelete = (msg) => {
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

  // Standalone block, without reporting. Someone can be tiresome without
  // having done anything a moderator needs to see.
  const confirmBlock = (sender) => {
    if (!sender?.id) return;
    Alert.alert(
      `Block ${sender.name}?`,
      "You'll stop seeing their messages in every group. They can still see yours, "
      + "and they won't be told. You can undo this from your profile.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await chatApi.blockUser(sender.id, sender.role);
              applyBlock(sender);
              Alert.alert('Blocked', `You will no longer see messages from ${sender.name}.`);
            } catch (err) {
              Alert.alert("Couldn't block", err?.response?.data?.message || 'Try again.');
            }
          },
        },
      ]
    );
  };

  // Hide their messages immediately rather than waiting for a refetch —
  // the whole point of blocking is that the content goes away now.
  const applyBlock = (sender) => {
    const key = `${sender.role}:${sender.id}`;
    setBlockedKeys((prev) => new Set(prev).add(key));
    setMessages((prev) => prev.filter((m) => `${m.sender?.role}:${m.sender?.id}` !== key));
  };

  const submitReport = async ({ reason, blockSender }) => {
    if (!reportTarget) return;
    setReporting(true);
    try {
      const res = await chatApi.reportMessage(groupId, reportTarget.id, { reason, blockSender });
      const sender = reportTarget.sender;
      setReportTarget(null);
      if (blockSender && sender?.id) applyBlock(sender);

      const alreadyReported = res?.data?.already_reported;
      Alert.alert(
        alreadyReported ? 'Already reported' : 'Report sent',
        [
          alreadyReported
            ? 'You had already reported this message. Our team is reviewing it.'
            : 'Thank you. Our moderation team will review this message.',
          blockSender ? `You will no longer see messages from ${sender?.name}.` : null,
          `${sender?.name || 'They'} will not be told.`,
        ].filter(Boolean).join('\n\n')
      );
    } catch (err) {
      Alert.alert(
        "Couldn't send the report",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setReporting(false);
    }
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
            // Every live message now has actions behind a long press, so
            // the pressed state is no longer conditional on being able to
            // delete — it would have made reporting feel unavailable.
            pressed && !item.is_deleted && { opacity: 0.7 },
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
        behavior="padding"
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

        {/* Composer. A moderator can close it — the member keeps reading
            the room, which is where their zone's delivery announcements
            are, but cannot post. Shown as a bar rather than a hidden
            input, so the state is explained instead of just broken. */}
        {banInfo ? (
          <View style={styles.bannedBar}>
            <Ionicons name="remove-circle-outline" size={18} color={colors.inkFaint} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannedTitle}>You can no longer post in this group</Text>
              <Text style={styles.bannedHint}>
                {banInfo.reason
                  ? `Reason: ${banInfo.reason}`
                  : 'Contact an admin if you think this is a mistake.'}
              </Text>
            </View>
          </View>
        ) : (
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
        )}
      </KeyboardAvoidingView>

      {/* Mounted only while a report is open, so the sheet's fields are
          fresh for each report without a reset effect. */}
      {reportTarget && (
        <ReportMessageSheet
          visible
          senderName={reportTarget.sender?.name}
          messagePreview={reportTarget.content}
          submitting={reporting}
          onCancel={() => setReportTarget(null)}
          onSubmit={submitReport}
        />
      )}
    </SafeAreaView>
  );
}

// Trim a message for the action-sheet title so a long paragraph does not
// push the actions off a small screen.
function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

  bannedBar: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    padding: space[4],
    backgroundColor: colors.paperSoft,
    borderTopWidth: 1, borderTopColor: colors.ruleSoft,
  },
  bannedTitle: { ...type.metaStrong },
  bannedHint:  { ...type.meta, marginTop: 2 },

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
