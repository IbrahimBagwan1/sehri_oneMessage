import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '../../theme';

/**
 * RubStar — the ۞ glyph (Rub el Hizb, U+06DE).
 *
 * The 8-point star used in the Quran to mark quarter-divisions of a
 * hizb. Here it serves as a subtle, meaningful ornament — small and
 * gold-toned — on section headers and hero dividers. Used with
 * restraint: the app's overall design plan reserves it for genuinely
 * ceremonial moments, not decoration on every card.
 */
export default function RubStar({ size = 14, color = colors.gold, style }) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.glyph, { fontSize: size, color }, style]}
    >
      ۞
    </Text>
  );
}

const styles = StyleSheet.create({
  glyph: {
    textAlign: 'center',
    // Line-height slightly tighter than fontSize so the star sits
    // vertically centered when composed inline with other text.
    lineHeight: undefined,
  },
});
