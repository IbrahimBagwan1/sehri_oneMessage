import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoidingView } from './ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// ReportMessageSheet — confirm before a message is reported.
//
// This is a trust-and-safety surface, so it is written for someone who has
// just been upset by something. That shapes every decision here:
//
//   • It states plainly what happens next and who sees it. Someone
//     reporting a neighbour in a small community wants to know whether
//     that neighbour will find out. The answer is no, and it is on screen
//     before they commit, not in a toast afterwards.
//   • The reason field is OPTIONAL. Requiring a category before someone
//     can escape something abusive puts a form between them and relief.
//   • Blocking rides along as a checkbox, because the two things usually
//     want doing together and finding a second screen is friction at the
//     worst moment.
//   • Nothing is destructive-red until the destructive action itself. The
//     sheet is calm; the confirm button carries the weight.
//
// Visually it follows the app's own system — the gold rule and Rub el Hizb
// motif used across the Dua and Qur'an surfaces — rather than copying the
// reference screenshot's styling.
// -----------------------------------------------------------------------------

const MAX_REASON = 300;

export default function ReportMessageSheet({
  visible,
  senderName,
  messagePreview,
  submitting = false,
  onCancel,
  onSubmit,           // ({ reason, blockSender }) => void
}) {
  // No reset effect and no key juggling: the parent mounts this component
  // only while a report is open, so every report starts from a genuinely
  // fresh state. It also means a FAILED submit keeps what the person
  // typed, instead of making them write their reason out twice.
  const [reason, setReason] = useState('');
  const [blockSender, setBlockSender] = useState(false);

  const close = () => {
    if (submitting) return;
    onCancel();
  };

  const submit = () => {
    if (submitting) return;
    onSubmit({ reason: reason.trim(), blockSender });
  };

  const who = senderName || 'this person';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      // Android renders a Modal in its own window. These two tell that
      // window it is edge-to-edge, which is what lets the keyboard inset
      // reach the view below.
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled">
            {/* Icon + heading */}
            <View style={styles.iconWrap}>
              <Ionicons name="flag-outline" size={26} color={colors.gold} />
            </View>
            <Text style={styles.title}>Report this message</Text>
            <View style={styles.rule} />

            <Text style={styles.body}>
              The message and who sent it will be sent to our moderation team
              to review.
            </Text>
            <Text style={styles.bodyStrong}>
              {who} will not be told that you reported them.
            </Text>

            {/* What is being reported — so nobody reports the wrong message */}
            {messagePreview ? (
              <View style={styles.quote}>
                <Text style={styles.quoteAuthor} numberOfLines={1}>{who}</Text>
                <Text style={styles.quoteText} numberOfLines={3}>{messagePreview}</Text>
              </View>
            ) : null}

            {/* Optional context */}
            <Text style={styles.fieldLabel}>
              Anything to add? <Text style={styles.optional}>Optional</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={(t) => setReason(t.slice(0, MAX_REASON))}
              placeholder="What is wrong with this message?"
              placeholderTextColor={colors.inkGhost}
              multiline
              editable={!submitting}
              accessibilityLabel="Reason for reporting, optional"
            />
            {reason.length > 0 && (
              <Text style={styles.counter}>{MAX_REASON - reason.length} left</Text>
            )}

            {/* Block checkbox — mirrors the reference flow's shape */}
            <Pressable
              onPress={() => !submitting && setBlockSender((v) => !v)}
              style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: blockSender }}
              accessibilityLabel={`Also block ${who}`}
              hitSlop={6}
            >
              <Ionicons
                name={blockSender ? 'checkbox' : 'square-outline'}
                size={22}
                color={blockSender ? colors.teal : colors.inkFaint}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkLabel}>Also block {who}</Text>
                <Text style={styles.checkHint}>
                  You will stop seeing their messages in every group. They can still
                  see yours, and they are not told.
                </Text>
              </View>
            </Pressable>

            {/* Actions */}
            <View style={styles.actions}>
              <Pressable
                onPress={close}
                disabled={submitting}
                style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.btn, styles.btnPrimary,
                  pressed && styles.btnPrimaryPressed,
                  submitting && styles.btnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send report"
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={colors.paper} />
                ) : (
                  <Text style={styles.btnPrimaryText}>Report</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    paddingHorizontal: space[5],
  },
  sheet: {
    backgroundColor: colors.paper,
    borderRadius: radius.xl,
    padding: space[5],
    maxHeight: '86%',
  },

  iconWrap: {
    alignSelf: 'center',
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.goldSoft,
    borderWidth: 1, borderColor: colors.goldBorder,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space[3],
  },
  title: { ...type.display, fontSize: 21, textAlign: 'center' },
  rule: {
    height: 1, backgroundColor: colors.goldBorder,
    width: 56, alignSelf: 'center',
    marginTop: space[3], marginBottom: space[4],
  },

  body:       { ...type.body, textAlign: 'center' },
  bodyStrong: {
    ...type.body, textAlign: 'center',
    color: colors.ink, fontWeight: '600',
    marginTop: space[2],
  },

  quote: {
    marginTop: space[4],
    paddingLeft: space[3],
    paddingVertical: space[2],
    borderLeftWidth: 3,
    borderLeftColor: colors.ruleSoft,
    backgroundColor: colors.paperSoft,
    borderRadius: radius.sm,
    paddingRight: space[3],
  },
  quoteAuthor: { ...type.micro, color: colors.tealDark, marginBottom: 2 },
  quoteText:   { ...type.meta, color: colors.inkMuted },

  fieldLabel: { ...type.metaStrong, marginTop: space[4], marginBottom: space[2] },
  optional:   { ...type.meta, fontWeight: '400', color: colors.inkGhost },
  input: {
    minHeight: 72,
    borderWidth: 1, borderColor: colors.ruleSoft,
    borderRadius: radius.md,
    backgroundColor: colors.paperSoft,
    paddingHorizontal: space[3], paddingVertical: space[2],
    fontSize: 15, color: colors.ink,
    textAlignVertical: 'top',
  },
  counter: { ...type.micro, color: colors.inkGhost, alignSelf: 'flex-end', marginTop: 4 },

  checkRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space[3],
    marginTop: space[4],
    padding: space[3],
    borderWidth: 1, borderColor: colors.ruleSoft,
    borderRadius: radius.md,
    // 44pt minimum touch target even though the row is taller than that.
    minHeight: 44,
  },
  checkLabel: { ...type.bodyStrong },
  checkHint:  { ...type.meta, marginTop: 2 },

  actions: { flexDirection: 'row', gap: space[2], marginTop: space[5] },
  btn: {
    flex: 1, minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhost:      { backgroundColor: colors.paperSoft, borderWidth: 1, borderColor: colors.ruleSoft },
  btnGhostText:  { ...type.bodyStrong, color: colors.inkMuted },
  btnPrimary:        { backgroundColor: colors.teal },
  btnPrimaryPressed: { backgroundColor: colors.tealDark },
  btnPrimaryText:    { ...type.bodyStrong, color: colors.paper },
  btnDisabled:   { opacity: 0.6 },
  pressed:       { opacity: 0.7 },
});
