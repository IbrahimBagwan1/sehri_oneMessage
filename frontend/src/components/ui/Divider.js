import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, space } from '../../theme';

/**
 * Divider — hairline separator.
 *
 *   tone: 'faint' (default) — for row separators inside a card
 *         'soft'            — for section separators
 *         'gold'            — for semantic separators inside Quran/Dua
 *                             (Arabic ↔ transliteration ↔ translation)
 *
 * `inset` shifts the divider right by 60px so it aligns with content
 * beside a leading medallion (chapter list rows do this).
 */
export default function Divider({ tone = 'faint', inset = false, style }) {
  return (
    <View
      style={[
        styles.base,
        TONES[tone],
        inset && styles.inset,
        style,
      ]}
    />
  );
}

const TONES = {
  faint: { backgroundColor: colors.ruleFaint },
  soft:  { backgroundColor: colors.ruleSoft },
  gold:  { backgroundColor: colors.goldBorder, opacity: 0.6 },
};

const styles = StyleSheet.create({
  base:  { height: StyleSheet.hairlineWidth < 1 ? 1 : StyleSheet.hairlineWidth },
  inset: { marginLeft: 60 },
});
