import React, { useState, forwardRef } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';

/**
 * Input — text input with a consistent 48h touch target, focus ring,
 * and optional left icon.
 *
 * For password fields with a show/hide toggle, use the existing
 * PasswordInput (components/PasswordInput.js) — this Input is the
 * general-purpose one.
 */
const Input = forwardRef(function Input(
  {
    icon,           // Ionicons name — optional left icon
    style,          // extend the inner TextInput style
    containerStyle, // extend the outer wrapper
    multiline = false,
    ...textInputProps
  },
  ref
) {
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.container,
        focused && styles.containerFocused,
        multiline && styles.containerMultiline,
        containerStyle,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={18}
          color={focused ? colors.teal : colors.inkGhost}
          style={styles.icon}
        />
      )}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.inkGhost}
        selectionColor={colors.teal}
        {...textInputProps}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          textInputProps.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          textInputProps.onBlur?.(e);
        }}
        style={[styles.input, multiline && styles.inputMultiline, style]}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
  },
  containerMultiline: {
    alignItems: 'flex-start',
    paddingTop: space[3],
    paddingBottom: space[3],
    minHeight: 96,
  },
  containerFocused: {
    borderColor: colors.teal,
  },
  icon: { marginRight: space[2] },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: space[2],
  },
  inputMultiline: {
    textAlignVertical: 'top',
    minHeight: 72,
  },
});

export default Input;
