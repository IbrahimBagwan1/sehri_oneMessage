import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  Modal,
  ScrollView,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { chatModerationApi } from '../../api/chat';
import {
  Avatar,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Reported messages — the moderation queue.
//
// Both app stores require the operator to be able to act on reports, not
// just collect them. This is that screen.
//
// It is built around the decision a moderator actually makes, which is
// rarely "is this bad" in isolation. So each row carries the things that
// change the answer: what was said, who said it, who objected, whether the
// message is still up, whether this person has been reported before.
//
// The count of prior reports is the one that matters most. A single heated
// message is usually nothing; the fifth report against the same person is a
// pattern, and a queue that made you search for that would hide it.
//
// Scope is enforced server-side: an admin sees reports from groups covering
// their own zone, a super admin sees everything.
// -----------------------------------------------------------------------------

const FILTERS = [
  { key: 'pending',  label: 'Pending' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'all',      label: 'All' },
];

export default function ChatReportsScreen() {
  const router = useRouter();

  const [status, setStatus]         = useState('pending');
  const [reports, setReports]       = useState([]);
  const [pendingCount, setPending]  = useState(0);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [active, setActive]         = useState(null); // report open in the action sheet

  const load = useCallback(async (nextStatus, isRefresh = false) => {
    const s = nextStatus || status;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await chatModerationApi.listReports({ status: s, limit: 50 });
      if (res.success) {
        setReports(res.data.reports || []);
        setPending(res.data.pending_count || 0);
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load reports.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changeFilter = (key) => {
    setStatus(key);
    load(key);
  };

  const onResolved = () => {
    setActive(null);
    load(status, true);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header
        title="Reported messages"
        subtitle={pendingCount > 0 ? `${pendingCount} waiting` : 'Nothing waiting'}
        onBack={() => router.back()}
      />

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => changeFilter(f.key)}
            style={({ pressed }) => [
              styles.filterChip,
              status === f.key && styles.filterChipOn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: status === f.key }}
          >
            <Text style={[styles.filterText, status === f.key && styles.filterTextOn]}>
              {f.label}
              {f.key === 'pending' && pendingCount > 0 ? ` · ${pendingCount}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <LoadingState message="Loading reports…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={status === 'pending' ? 'shield-checkmark-outline' : 'file-tray-outline'}
          title={status === 'pending' ? 'Nothing to review' : 'No reports here'}
          message={
            status === 'pending'
              ? 'Reported messages appear here for you to act on. An empty queue is a good sign.'
              : 'Nothing matches this filter yet.'
          }
        />
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(status, true)}
              colors={[colors.teal]}
              tintColor={colors.teal}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          renderItem={({ item }) => (
            <ReportCard report={item} onPress={() => setActive(item)} />
          )}
        />
      )}

      {active && (
        <ActionSheet
          report={active}
          onClose={() => setActive(null)}
          onResolved={onResolved}
        />
      )}
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// One report. The reported TEXT leads, because that is what the decision is
// about — everything else is context for it.
// -----------------------------------------------------------------------------
function ReportCard({ report, onPress }) {
  const isPending = report.status === 'pending';
  const repeat = report.total_reports_against_user > 1;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Report against ${report.reported_user?.name}`}
    >
      <Card style={isPending ? styles.cardPending : undefined}>
        <View style={styles.cardHead}>
          <Chip
            label={isPending ? 'Pending' : 'Reviewed'}
            tone={isPending ? 'warn' : 'success'}
            icon={isPending ? 'time-outline' : 'checkmark-circle-outline'}
          />
          {repeat && (
            <Chip
              label={`${report.total_reports_against_user} reports`}
              tone="danger"
              icon="alert-circle-outline"
            />
          )}
          <View style={{ flex: 1 }} />
          <Text style={styles.when}>{formatWhen(report.reported_at)}</Text>
        </View>

        {/* The message itself */}
        <View style={styles.quote}>
          <Text style={styles.quoteText}>{report.message_snapshot}</Text>
        </View>

        {!report.message_still_visible && (
          <View style={styles.inlineNote}>
            <Ionicons name="eye-off-outline" size={13} color={colors.inkFaint} />
            <Text style={styles.inlineNoteText}>
              {report.message_exists
                ? 'Already deleted from the group'
                : 'The message no longer exists'}
            </Text>
          </View>
        )}

        <View style={styles.people}>
          <View style={styles.person}>
            <Avatar name={report.reported_user?.name} size={26} />
            <View style={{ flex: 1 }}>
              <Text style={styles.personLabel}>Reported</Text>
              <Text style={styles.personName} numberOfLines={1}>
                {report.reported_user?.name}
              </Text>
            </View>
            {report.reported_user_banned && <Chip label="Banned" tone="danger" />}
          </View>
          <View style={styles.person}>
            <Avatar name={report.reporter?.name} size={26} />
            <View style={{ flex: 1 }}>
              <Text style={styles.personLabel}>Reported by</Text>
              <Text style={styles.personName} numberOfLines={1}>{report.reporter?.name}</Text>
            </View>
          </View>
        </View>

        {report.reason ? (
          <Text style={styles.reason} numberOfLines={2}>“{report.reason}”</Text>
        ) : null}

        <View style={styles.cardFoot}>
          <Ionicons name="chatbubbles-outline" size={13} color={colors.inkGhost} />
          <Text style={styles.groupName}>{report.group?.name}</Text>
          <View style={{ flex: 1 }} />
          {isPending ? (
            <Text style={styles.reviewCta}>Review →</Text>
          ) : (
            <Text style={styles.outcome}>{describeAction(report.action_taken)}</Text>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// Action sheet. Three outcomes, each spelled out, plus a note that becomes
// the ban reason the member is shown — so a ban is never unexplained.
// -----------------------------------------------------------------------------
function ActionSheet({ report, onClose, onResolved }) {
  const [deleteMessage, setDeleteMessage] = useState(false);
  const [banUser, setBanUser]             = useState(false);
  const [note, setNote]                   = useState('');
  const [submitting, setSubmitting]       = useState(false);

  const alreadyGone   = !report.message_still_visible;
  const alreadyBanned = report.reported_user_banned;
  const reviewed      = report.status === 'reviewed';

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await chatModerationApi.resolveReport(report.id, {
        deleteMessage, banUser, note: note.trim(),
      });
      const extra = res?.data?.also_resolved
        ? `\n\n${res.data.also_resolved} other report(s) about the same message were resolved too.`
        : '';
      Alert.alert('Report resolved', `${res.message}${extra}`);
      onResolved();
    } catch (err) {
      Alert.alert(
        "Couldn't resolve",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const confirm = () => {
    if (!deleteMessage && !banUser) {
      Alert.alert(
        'Mark reviewed with no action?',
        'The message stays up and nothing happens to the member. The report '
        + 'leaves the pending queue.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Mark reviewed', onPress: submit },
        ]
      );
      return;
    }
    const parts = [];
    if (deleteMessage) parts.push('the message will be deleted for everyone');
    if (banUser) parts.push(`${report.reported_user?.name} will no longer be able to post in ${report.group?.name}`);
    Alert.alert(
      'Apply these actions?',
      `${parts.join(', and ')}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Apply', style: 'destructive', onPress: submit },
      ]
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Review report</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={colors.inkFaint} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            <View style={styles.quote}>
              <Text style={styles.quoteText}>{report.message_snapshot}</Text>
            </View>
            <Text style={styles.sheetMeta}>
              {report.reported_user?.name} · {report.group?.name}
              {report.total_reports_against_user > 1
                ? ` · reported ${report.total_reports_against_user} times`
                : ''}
            </Text>
            {report.reason ? (
              <Text style={styles.sheetReason}>
                {report.reporter?.name} wrote: “{report.reason}”
              </Text>
            ) : null}

            {reviewed && (
              <View style={styles.reviewedNote}>
                <Ionicons name="information-circle-outline" size={15} color={colors.inkFaint} />
                <Text style={styles.inlineNoteText}>
                  Already reviewed — {describeAction(report.action_taken).toLowerCase()}.
                  You can act again if something was missed.
                </Text>
              </View>
            )}

            {/* --- actions --- */}
            <Text style={styles.sectionLabel}>What should happen?</Text>

            <ActionToggle
              on={deleteMessage}
              disabled={alreadyGone}
              icon="trash-outline"
              title="Delete the message"
              hint={alreadyGone
                ? 'Already deleted from the group.'
                : "Everyone sees 'This message was deleted'. Replies to it stay intact."}
              onPress={() => setDeleteMessage((v) => !v)}
            />

            <ActionToggle
              on={banUser}
              disabled={alreadyBanned || !report.reported_user_in_group}
              icon="remove-circle-outline"
              title={`Stop ${report.reported_user?.name} posting here`}
              hint={
                alreadyBanned ? 'Already banned from this group.'
                  : !report.reported_user_in_group ? 'No longer a member of this group.'
                    : 'They can still read the group — which is where their zone’s '
                      + 'delivery announcements are — but cannot post. Reversible.'
              }
              onPress={() => setBanUser((v) => !v)}
            />

            <Text style={styles.sectionLabel}>
              Note <Text style={styles.optional}>Optional</Text>
            </Text>
            <Text style={styles.noteHint}>
              Kept on the report. If you ban someone, this is the reason they are shown.
            </Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={(t) => setNote(t.slice(0, 500))}
              placeholder="e.g. Repeated abusive language"
              placeholderTextColor={colors.inkGhost}
              multiline
              editable={!submitting}
            />
          </ScrollView>

          <View style={styles.sheetActions}>
            <Pressable
              onPress={onClose}
              disabled={submitting}
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={submitting}
              style={({ pressed }) => [
                styles.btn, styles.btnPrimary,
                pressed && styles.btnPrimaryPressed,
                submitting && styles.pressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.paper} />
              ) : (
                <Text style={styles.btnPrimaryText}>
                  {deleteMessage || banUser ? 'Apply' : 'Mark reviewed'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ActionToggle({ on, disabled, icon, title, hint, onPress }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.toggle,
        on && styles.toggleOn,
        disabled && styles.toggleDisabled,
        pressed && !disabled && styles.pressed,
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled }}
    >
      <Ionicons
        name={disabled ? 'checkmark-circle-outline' : on ? 'checkbox' : 'square-outline'}
        size={22}
        color={disabled ? colors.inkGhost : on ? colors.danger : colors.inkFaint}
      />
      <View style={{ flex: 1 }}>
        <View style={styles.toggleTitleRow}>
          <Ionicons name={icon} size={15} color={disabled ? colors.inkGhost : colors.inkMuted} />
          <Text style={[styles.toggleTitle, disabled && { color: colors.inkGhost }]}>{title}</Text>
        </View>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

function describeAction(action) {
  switch (action) {
    case 'message_deleted': return 'Message deleted';
    case 'user_banned':     return 'Member banned';
    case 'both':            return 'Deleted + banned';
    case 'none':            return 'No action needed';
    default:                return 'Reviewed';
  }
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  list:   { padding: space[4], paddingBottom: space[10] },

  filters: {
    flexDirection: 'row', gap: space[2],
    paddingHorizontal: space[4], paddingBottom: space[3],
    backgroundColor: colors.paper,
    borderBottomWidth: 1, borderBottomColor: colors.ruleFaint,
  },
  filterChip: {
    minHeight: 36, paddingHorizontal: space[3], justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.ruleSoft,
  },
  filterChipOn:  { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  filterText:    { ...type.metaStrong, color: colors.inkFaint },
  filterTextOn:  { color: colors.tealDark },

  cardPending: { borderLeftWidth: 3, borderLeftColor: colors.warn },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3] },
  when:     { ...type.micro, color: colors.inkGhost },

  quote: {
    paddingLeft: space[3], paddingRight: space[3],
    paddingVertical: space[3],
    borderLeftWidth: 3, borderLeftColor: colors.ruleSoft,
    backgroundColor: colors.paperSoft,
    borderRadius: radius.sm,
  },
  quoteText: { fontSize: 15, lineHeight: 21, color: colors.ink },

  inlineNote:     { flexDirection: 'row', alignItems: 'center', gap: space[1], marginTop: space[2] },
  inlineNoteText: { ...type.meta, flex: 1 },

  people:      { marginTop: space[3], gap: space[2] },
  person:      { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  personLabel: { ...type.micro, color: colors.inkGhost },
  personName:  { ...type.metaStrong },

  reason: { ...type.meta, fontStyle: 'italic', marginTop: space[3] },

  cardFoot: {
    flexDirection: 'row', alignItems: 'center', gap: space[1],
    marginTop: space[3], paddingTop: space[3],
    borderTopWidth: 1, borderTopColor: colors.ruleFaint,
  },
  groupName:  { ...type.micro, color: colors.inkFaint },
  reviewCta:  { ...type.metaStrong, color: colors.teal },
  outcome:    { ...type.micro, color: colors.inkFaint },

  backdrop: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: space[4], paddingBottom: space[6],
  },
  sheetHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space[3] },
  sheetTitle: { ...type.display, fontSize: 20 },
  sheetMeta:   { ...type.meta, marginTop: space[2] },
  sheetReason: { ...type.meta, fontStyle: 'italic', marginTop: space[1] },
  reviewedNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space[2],
    marginTop: space[3], padding: space[3],
    backgroundColor: colors.paperSoft, borderRadius: radius.md,
  },

  sectionLabel: { ...type.metaStrong, marginTop: space[4], marginBottom: space[2] },
  optional:     { ...type.meta, fontWeight: '400', color: colors.inkGhost },
  noteHint:     { ...type.meta, marginTop: -space[1], marginBottom: space[2] },

  toggle: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space[3],
    padding: space[3], marginBottom: space[2],
    borderWidth: 1, borderColor: colors.ruleSoft, borderRadius: radius.md,
    minHeight: 44,
  },
  toggleOn:       { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  toggleDisabled: { opacity: 0.55 },
  toggleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  toggleTitle:    { ...type.bodyStrong, flex: 1 },
  toggleHint:     { ...type.meta, marginTop: 2 },

  input: {
    minHeight: 64,
    borderWidth: 1, borderColor: colors.ruleSoft, borderRadius: radius.md,
    backgroundColor: colors.paperSoft,
    paddingHorizontal: space[3], paddingVertical: space[2],
    fontSize: 15, color: colors.ink, textAlignVertical: 'top',
  },

  sheetActions: { flexDirection: 'row', gap: space[2], marginTop: space[4] },
  btn: { flex: 1, minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost:          { backgroundColor: colors.paperSoft, borderWidth: 1, borderColor: colors.ruleSoft },
  btnGhostText:      { ...type.bodyStrong, color: colors.inkMuted },
  btnPrimary:        { backgroundColor: colors.teal },
  btnPrimaryPressed: { backgroundColor: colors.tealDark },
  btnPrimaryText:    { ...type.bodyStrong, color: colors.paper },

  pressed: { opacity: 0.7 },
});
