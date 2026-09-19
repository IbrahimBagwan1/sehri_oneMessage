import React, { useState, forwardRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * PasswordInput — TextInput with an inline eye toggle for show/hide.
 *
 * Matches the visual styling used across the auth screens so it drops
 * into login/register/forgot-password/rider-login without any per-screen
 * style tweaks. Consumers pass the same props they'd pass to a bare
 * TextInput (value, onChangeText, placeholder, autoComplete, etc.);
 * `secureTextEntry` is managed internally by the toggle.
 *
 * Forward ref so screens can .focus() the input (register.js chains
 * inputs via onSubmitEditing).
 */
const PasswordInput = forwardRef(function PasswordInput(
  { style, containerStyle, ...textInputProps },
  ref
) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <TextInput
        ref={ref}
        {...textInputProps}
        style={[styles.input, style]}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
      />
      <TouchableOpacity
        style={styles.iconButton}
        onPress={() => setVisible((v) => !v)}
        // Hit-slop lets thumbs land on the icon without being pixel-perfect.
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      >
        <Ionicons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={20}
          color="#64748B"
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingLeft: 12,
    // Extra right padding so text never runs under the eye icon.
    paddingRight: 44,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0F172A',
  },
  iconButton: {
    position: 'absolute',
    right: 10,
    padding: 4,
  },
});

export default PasswordInput;
