import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout } from '../../theme';

/**
 * Avatar — circular initial or icon, tappable.
 *
 * Falls back to a person icon if no name is supplied. Sized to meet
 * the 44px minimum touch target when interactive.
 */
export default function Avatar({ name, size = 40, onPress, accessibilityLabel }) {
  const initial = getInitial(name);
  const body = (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      accessibilityElementsHidden={!!onPress}
    >
      {initial ? (
        <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
      ) : (
        <Ionicons name="person" size={size * 0.55} color={colors.tealDark} />
      )}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || 'Profile'}
      hitSlop={size < layout.minTouchTarget ? 8 : 0}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      {body}
    </Pressable>
  );
}

function getInitial(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  return trimmed.charAt(0).toUpperCase();
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: colors.tealDark,
    fontWeight: '700',
  },
});
