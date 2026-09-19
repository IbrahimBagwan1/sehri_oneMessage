import React, { useState, useEffect, useCallback } from 'react';
import { Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';

/**
 * ResendOtpButton — text-only button with a countdown lockout.
 *
 * Shows "Resend in Ns" (disabled, gray) for the cooldown seconds after
 * the last send, then flips to "Resend OTP" (teal, tappable). On tap,
 * calls onResend(); if it resolves, restarts the countdown. Alerts on
 * failure with a plain, actionable message.
 *
 * Props:
 *  • onResend     — async () => any. Should throw / reject on failure.
 *  • initialSeconds  starting countdown (default 30). Set >0 to enforce
 *                    a cooldown from the initial OTP send too.
 *  • cooldownSeconds seconds to lock out after each subsequent resend
 *                    (default 30).
 */
export default function ResendOtpButton({
  onResend,
  initialSeconds = 30,
  cooldownSeconds = 30,
}) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const handlePress = useCallback(async () => {
    if (secondsLeft > 0 || busy) return;
    setBusy(true);
    try {
      await onResend();
      setSecondsLeft(cooldownSeconds);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Failed to resend OTP. Try again.';
      Alert.alert('Could not resend', msg);
    } finally {
      setBusy(false);
    }
  }, [secondsLeft, busy, onResend, cooldownSeconds]);

  const disabled = secondsLeft > 0 || busy;
  const label = disabled ? `Resend in ${secondsLeft}s` : 'Resend OTP';

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.text, disabled ? styles.textDisabled : styles.textActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
  textActive:   { color: '#0D9488' },
  textDisabled: { color: '#94A3B8' },
});
