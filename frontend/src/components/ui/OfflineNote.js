import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type } from '../../theme';
import { savedCopyLabel } from '../../api/errors';

/**
 * OfflineNote — one line saying the content on screen is a saved copy.
 *
 * Shown when a response came from the offline cache (`res.offline`), so a
 * member reading prayer times with no signal knows they are the copy saved
 * earlier rather than wondering why pull-to-refresh "worked". Renders
 * nothing when the content is fresh.
 */
export default function OfflineNote({ offline, style }) {
  const label = savedCopyLabel(offline);
  if (!label) return null;
  return (
    <View style={[styles.row, style]} accessibilityRole="text" accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline-outline" size={16} color={colors.inkMuted} accessibilityElementsHidden importantForAccessibility="no" />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.paperSoft,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
  },
  text: { ...type.meta, color: colors.inkMuted, flex: 1 },
});
