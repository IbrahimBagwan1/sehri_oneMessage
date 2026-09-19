import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, type } from '../../theme';
import Button from './Button';

/**
 * EmptyState — outline icon + plain sentence + optional action.
 *
 * Copy convention (per the design plan):
 *   • One sentence, not two paragraphs.
 *   • Explain what's here and what the user could do, if they can do
 *     anything about it.
 *   • Never "Oops!" or "Nothing here".
 *
 * Examples:
 *   "No feedback yet. When someone writes in, you'll see it here."
 *   "You haven't voted on any polls yet."
 */
export default function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  actionLabel,
  onAction,
  style,
}) {
  return (
    <View style={[styles.container, style]}>
      <Ionicons name={icon} size={40} color={colors.inkGhost} />
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.actionWrap}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space[8], gap: space[2] },
  title:     { ...type.bodyStrong, marginTop: space[2] },
  message:   { ...type.meta, textAlign: 'center', maxWidth: 300, lineHeight: 20 },
  actionWrap:{ marginTop: space[3] },
});
