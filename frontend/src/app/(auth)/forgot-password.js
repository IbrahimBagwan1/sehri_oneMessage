import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { authApi } from '../../api/auth';
import PasswordInput from '../../components/PasswordInput';
import ResendOtpButton from '../../components/ResendOtpButton';
import { Button, Header, Input, KeyboardAwareScroll } from '../../components/ui';
import { colors, space, type } from '../../theme';

export default function ForgotPasswordScreen() {
  const router = useRouter();

  const [phone, setPhone]                       = useState('');
  const [otp, setOtp]                           = useState('');
  const [newPassword, setNewPassword]           = useState('');
  const [confirmPassword, setConfirmPassword]   = useState('');
  const [otpSent, setOtpSent]                   = useState(false);
  const [loading, setLoading]                   = useState(false);

  const handleSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return Alert.alert('Check the number', "That doesn't look like a valid 10-digit Indian mobile number.");
    }
    setLoading(true);
    try {
      await authApi.sendOtp(phone, 'forgot_password');
      setOtpSent(true);
      Alert.alert('OTP sent', 'Enter the 6-digit code we just sent to your phone.');
    } catch (err) {
      Alert.alert("Couldn't send OTP", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!phone || !otp || !newPassword || !confirmPassword) {
      return Alert.alert('A few things missing', 'Fill in every field to reset your password.');
    }
    if (newPassword !== confirmPassword) {
      return Alert.alert("Passwords don't match", 'Re-enter your new password so they match.');
    }
    if (newPassword.length < 6) {
      return Alert.alert('Password too short', 'Use at least 6 characters.');
    }

    setLoading(true);
    try {
      await authApi.verifyOtp({ phone, otp, newPassword });
      Alert.alert(
        'Password updated',
        'You can now sign in with your new password.',
        [{ text: 'Go to sign-in', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch (err) {
      Alert.alert("Couldn't reset password", err?.response?.data?.message || 'Check your OTP and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Reset password" onBack={() => router.back()} />

      <KeyboardAwareScroll contentContainerStyle={styles.scroll}>
          <Text style={styles.intro}>
            Enter the phone number on your account. We'll send you a one-time code to verify it.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Phone number</Text>
            <Input
              placeholder="10-digit mobile"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={(v) => { setPhone(v.replace(/\D/g, '')); setOtpSent(false); }}
              maxLength={10}
              icon="call-outline"
              editable={!otpSent}
            />
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>OTP code</Text>
              {!otpSent && (
                <Button label="Send OTP" onPress={handleSendOtp} loading={loading} variant="ghost" size="sm" />
              )}
            </View>
            <Input
              placeholder="6-digit code"
              keyboardType="number-pad"
              value={otp}
              onChangeText={setOtp}
              maxLength={6}
              icon="lock-closed-outline"
              editable={otpSent}
            />
            {otpSent && (
              <ResendOtpButton onResend={() => authApi.sendOtp(phone, 'forgot_password')} />
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>New password</Text>
            <PasswordInput
              placeholder="At least 6 characters"
              value={newPassword}
              onChangeText={setNewPassword}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Confirm new password</Text>
            <PasswordInput
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
          </View>

          <Button
            label="Update password"
            onPress={handleReset}
            loading={loading}
            fullWidth
            style={styles.submit}
          />
      </KeyboardAwareScroll>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { padding: space[5], paddingBottom: space[8] },

  intro: { ...type.body, marginBottom: space[5] },

  field:    { marginBottom: space[4] },
  label:    { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  submit: { marginTop: space[3] },
});
