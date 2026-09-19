import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, type } from '../../theme';
import Button from './Button';

/**
 * ErrorState — the connection-error / load-failed pattern.
 *
 *   cloud-offline icon + one sentence stating what failed + Try again
 *
 * Copy the design plan's tone: what failed, and one thing the user
 * could try. Never "Oops" or "Something went wrong" — those are the
 * hallmark of a generic app.
 */
export default function ErrorState({
  icon = 'cloud-offline-outline',
  message = "Couldn't load this — check your connection and try again.",
  onRetry,
  retryLabel = 'Try again',
  style,
}) {
  return (
    <View style={[styles.container, style]}>
      <Ionicons name={icon} size={40} color={colors.inkGhost} />
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <View style={styles.actionWrap}>
          <Button label={retryLabel} onPress={onRetry} variant="primary" size="sm" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space[8], gap: space[3] },
  message:   { ...type.body, textAlign: 'center', color: colors.inkMuted, maxWidth: 320 },
  actionWrap:{ marginTop: space[1] },
});
