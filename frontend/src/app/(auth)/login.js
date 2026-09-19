import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/useAuthStore';
import { Button, Input, RubStar } from '../../components/ui';
import PasswordInput from '../../components/PasswordInput';
import { colors, space, type } from '../../theme';

export default function LoginScreen() {
  const router          = useRouter();
  const setAuth         = useAuthStore((s) => s.setAuth);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);

  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleGuest = async () => {
    await continueAsGuest();
    router.replace('/(user)');
  };

  const handleLogin = async () => {
    if (!phone) return Alert.alert('Missing phone', 'Enter your phone number to sign in.');
    if (!password) return Alert.alert('Missing password', 'Enter your password to sign in.');

    setLoading(true);
    try {
      const response = await authApi.login({ phone: phone.trim(), password });
      const { accessToken, refreshToken, active_role, available_roles, profile } = response.data;
      await setAuth(profile, accessToken, refreshToken, active_role, available_roles);

      if (active_role === 'super_admin') router.replace('/super-admin/superadmin-dashboard');
      else if (active_role === 'admin') router.replace('/(admin)');
      else router.replace('/(user)');
    } catch (err) {
      Alert.alert("Couldn't sign in", err?.response?.data?.message || 'Check your phone and password and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Brand block */}
          <View style={styles.brand}>
            <View style={styles.brandDotRow}>
              <View style={styles.brandDot} />
              <Text style={styles.brandName}>OneMessage</Text>
            </View>
            <View style={styles.brandRule}>
              <View style={styles.brandRuleLine} />
              <RubStar size={13} />
              <View style={styles.brandRuleLine} />
            </View>
            <Text style={styles.tagline}>Beyond Sehri. Together for every need.</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.formTitle}>Sign in</Text>
            <Text style={styles.formSubtitle}>Use the phone number you registered with.</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Phone number</Text>
              <Input
                placeholder="10-digit mobile number"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/\D/g, ''))}
                maxLength={10}
                icon="call-outline"
                autoComplete="tel"
                textContentType="telephoneNumber"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <PasswordInput
                placeholder="Your password"
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <Pressable
              onPress={() => router.push('/(auth)/forgot-password')}
              hitSlop={8}
              style={({ pressed }) => [styles.forgotWrap, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.forgot}>Forgot password?</Text>
            </Pressable>

            <Button
              label="Sign in"
              onPress={handleLogin}
              loading={loading}
              fullWidth
              style={styles.primaryBtn}
            />

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <Button
              label="I'm delivering today"
              variant="secondary"
              icon="bicycle-outline"
              onPress={() => router.push('/(rider)/login')}
              fullWidth
            />

            <Button
              label="Continue as guest"
              variant="ghost"
              icon="footsteps-outline"
              onPress={handleGuest}
              fullWidth
              style={styles.guestBtn}
            />
            <Text style={styles.guestHint}>
              Guests can read Qur&apos;an, Duas, and prayer times.
              Sign in to vote on the Sehri poll or track deliveries.
            </Text>
          </View>

          {/* Footer link */}
          <Pressable
            onPress={() => router.push('/(auth)/register')}
            hitSlop={8}
            style={({ pressed }) => [styles.footer, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.footerText}>
              New here? <Text style={styles.footerAction}>Create an account</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { flexGrow: 1, paddingHorizontal: space[5], paddingBottom: space[6] },

  brand:        { alignItems: 'center', marginTop: space[6], marginBottom: space[8] },
  brandDotRow:  { flexDirection: 'row', alignItems: 'center' },
  brandDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.teal, marginRight: space[2],
  },
  brandName:    { fontSize: 24, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  brandRule: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    marginTop: space[3], width: 160,
  },
  brandRuleLine:{ flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },
  tagline:      { ...type.meta, marginTop: space[2], textAlign: 'center' },

  form:         { marginBottom: space[6] },
  formTitle:    { ...type.h1 },
  formSubtitle: { ...type.meta, marginTop: space[1], marginBottom: space[5] },

  field:  { marginBottom: space[3] },
  label:  { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },

  forgotWrap: { alignSelf: 'flex-end', marginTop: space[1], marginBottom: space[4] },
  forgot:     { ...type.meta, color: colors.teal, fontWeight: '700' },

  primaryBtn: { marginTop: space[2] },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', gap: space[3], marginVertical: space[5] },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.ruleSoft },
  dividerText: { ...type.meta, color: colors.inkFaint },

  guestBtn:     { marginTop: space[2] },
  guestHint:    { ...type.meta, textAlign: 'center', marginTop: space[2], color: colors.inkFaint, lineHeight: 18 },

  footer:       { alignItems: 'center', paddingVertical: space[3] },
  footerText:   { ...type.body, color: colors.inkFaint },
  footerAction: { color: colors.teal, fontWeight: '700' },
});
