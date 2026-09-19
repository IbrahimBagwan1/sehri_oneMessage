import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, type, layout } from '../../theme';

/**
 * Header — the top strip of every screen. Two shapes:
 *
 * 1. Tab root (no back button): pass `leading` for a logo/wordmark and
 *    optionally `trailing` for an action.
 * 2. Push screen (with back): pass `onBack` and `title` (and optional
 *    subtitle + trailing).
 *
 * Enforces the app's header conventions: 14px vertical padding, hairline
 * bottom border, no shadow, consistent title placement.
 */
export default function Header({
  title,
  subtitle,
  onBack,
  leading,
  trailing,
  style,
}) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.side}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <Ionicons name="arrow-back" size={22} color={colors.ink} />
          </Pressable>
        ) : (
          leading || <View style={styles.spacer} />
        )}
      </View>

      <View style={styles.center}>
        {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      <View style={styles.side}>
        {trailing || <View style={styles.spacer} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[3],
    paddingVertical: 14,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
    minHeight: 56,
  },
  side:    { minWidth: layout.minTouchTarget, alignItems: 'flex-start', justifyContent: 'center' },
  center:  { flex: 1, alignItems: 'center', paddingHorizontal: space[2] },
  spacer:  { width: layout.minTouchTarget, height: layout.minTouchTarget },
  iconBtn: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  iconBtnPressed: { backgroundColor: colors.ruleFaint },
  title:    { ...type.h2 },
  subtitle: { ...type.meta, marginTop: 2 },
});
