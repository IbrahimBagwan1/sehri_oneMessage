import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';

/**
 * Chip — a soft-tint pill for status, tags, filters.
 *
 *   tone: 'neutral' | 'teal' | 'gold' | 'success' | 'warn' | 'danger'
 *
 * Wrap in Pressable behavior with onPress; otherwise renders as a
 * static View. Icon is optional and shows to the left of the label.
 *
 * Deliberate design constraint: no borders, no letter-spacing, no
 * uppercase. Emphasis comes from the color pairing.
 */
export default function Chip({
  label,
  tone = 'neutral',
  icon,
  onPress,
  selected = false,
  style,
  accessibilityLabel,
}) {
  const t = TONES[tone] || TONES.neutral;
  const inner = (
    <View style={[styles.container, { backgroundColor: t.bg }, selected && { backgroundColor: t.bgSelected || t.bg }, style]}>
      {icon && <Ionicons name={icon} size={12} color={t.fg} style={styles.icon} />}
      <Text style={[styles.label, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );

  if (!onPress) return inner;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      {inner}
    </Pressable>
  );
}

const TONES = {
  neutral: { bg: colors.ruleFaint, fg: colors.inkMuted, bgSelected: colors.ruleSoft },
  teal:    { bg: colors.tealSoft,  fg: colors.tealDark, bgSelected: colors.tealBorder },
  gold:    { bg: colors.goldSoft,  fg: colors.gold,     bgSelected: colors.goldBorder },
  success: { bg: colors.successSoft, fg: colors.success },
  warn:    { bg: colors.warnSoft,  fg: colors.warn },
  danger:  { bg: colors.dangerSoft, fg: colors.danger },
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.pill,
    minHeight: 22,
  },
  icon:  { marginRight: 4 },
  label: { fontSize: 11, fontWeight: '600' },
});
