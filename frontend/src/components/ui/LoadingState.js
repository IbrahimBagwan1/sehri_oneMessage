import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, space, type } from '../../theme';

/**
 * LoadingState — spinner + a contextual sentence.
 *
 * Never used with a generic "Loading…" — always give the user context:
 *   <LoadingState message="Loading Surah Al-Baqarah…" />
 *   <LoadingState message="Loading today's poll…" />
 *
 * If nothing contextual makes sense, prefer a placeholder card in the
 * page's layout over a generic centered spinner.
 */
export default function LoadingState({ message, compact = false, style }) {
  return (
    <View style={[compact ? styles.compact : styles.full, style]}>
      <ActivityIndicator size={compact ? 'small' : 'large'} color={colors.teal} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  full:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space[8], gap: space[3] },
  compact: { alignItems: 'center', padding: space[4], gap: space[2] },
  message: { ...type.meta, textAlign: 'center' },
});
