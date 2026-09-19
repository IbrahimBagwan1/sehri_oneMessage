import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius, space, elevation as elev } from '../../theme';

/**
 * Card — flat by default (1px border, no shadow). This is the app's
 * default surface.
 *
 * Pass `elevated` for genuine floating surfaces (featured-today, modal
 * sheets, FABs). Never mix flat + shadowed cards on the same screen
 * without a reason — that's the "AI-generated" look.
 *
 * Pass `tone` to switch the fill:
 *   'paper' (default) — white surface on paperSoft background
 *   'warm'            — parchment tint used for hero / featured content
 *   'teal'            — soft teal wash for actionable surfaces
 *
 * Pass `padding={false}` to nest sections inside without double-padding.
 */
export default function Card({
  children,
  tone = 'paper',
  elevated = false,
  padding = true,
  style,
  ...rest
}) {
  const toneStyle = TONES[tone] || TONES.paper;

  return (
    <View
      style={[
        styles.base,
        toneStyle.container,
        padding && styles.padded,
        elevated ? elev.low : styles.flatBorder,
        elevated && { borderWidth: 0 },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const TONES = {
  paper: { container: { backgroundColor: colors.paper } },
  warm:  { container: { backgroundColor: colors.goldSoft, borderColor: colors.goldBorder } },
  teal:  { container: { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder } },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  padded:     { padding: space[4] },
  flatBorder: { borderWidth: 1, borderColor: colors.ruleSoft },
});
