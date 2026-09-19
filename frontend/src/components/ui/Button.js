import React from 'react';
import { Pressable, Text, ActivityIndicator, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, layout } from '../../theme';

/**
 * Button — the only button component in the app. Three variants, two sizes.
 *
 *   variant: 'primary' | 'secondary' | 'ghost'
 *   size:    'md' (default 48h) | 'sm' (36h)
 *   icon:    Ionicons name, shown before the label
 *   loading: shows a spinner and disables interaction
 *   fullWidth: stretches to fill its container
 *
 * All buttons share the same radius, iconography, and pressed-state
 * animation. Screens should never roll their own TouchableOpacity + Text
 * for actions — always use this.
 */
export default function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight = false,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityLabel,
}) {
  const isDisabled = disabled || loading;
  const variantStyles = VARIANTS[variant];
  const sizeStyles    = SIZES[size];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [
        styles.base,
        sizeStyles.container,
        variantStyles.container,
        fullWidth && styles.fullWidth,
        pressed && !isDisabled && variantStyles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyles.spinner} />
      ) : (
        <View style={styles.contentRow}>
          {icon && !iconRight && (
            <Ionicons name={icon} size={sizeStyles.icon} color={variantStyles.label.color} style={styles.iconLeft} />
          )}
          <Text style={[sizeStyles.label, variantStyles.label]} numberOfLines={1}>
            {label}
          </Text>
          {icon && iconRight && (
            <Ionicons name={icon} size={sizeStyles.icon} color={variantStyles.label.color} style={styles.iconRight} />
          )}
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------
const VARIANTS = {
  primary: {
    container: { backgroundColor: colors.teal, borderWidth: 0 },
    pressed:   { backgroundColor: colors.tealDark },
    label:     { color: colors.paper },
    spinner:   colors.paper,
  },
  secondary: {
    container: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.teal },
    pressed:   { backgroundColor: colors.tealSoft },
    label:     { color: colors.teal },
    spinner:   colors.teal,
  },
  ghost: {
    container: { backgroundColor: 'transparent', borderWidth: 0 },
    pressed:   { backgroundColor: colors.tealSoft },
    label:     { color: colors.teal },
    spinner:   colors.teal,
  },
};

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------
const SIZES = {
  md: {
    container: { minHeight: 48, paddingHorizontal: space[5] },
    label:     { fontSize: 15, fontWeight: '700' },
    icon:      18,
  },
  sm: {
    container: { minHeight: 36, paddingHorizontal: space[4] },
    label:     { fontSize: 13, fontWeight: '700' },
    icon:      15,
  },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: layout.minTouchTarget,
  },
  fullWidth:  { alignSelf: 'stretch' },
  disabled:   { opacity: 0.5 },
  contentRow: { flexDirection: 'row', alignItems: 'center' },
  iconLeft:   { marginRight: space[2] },
  iconRight:  { marginLeft: space[2] },
});
