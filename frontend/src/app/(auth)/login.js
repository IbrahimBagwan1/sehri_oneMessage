import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/useAuthStore';
import { Button, Input, RubStar, KeyboardAwareScroll } from '../../components/ui';
import PasswordInput from '../../components/PasswordInput';
import { colors, radius, space, type } from '../../theme';
// Amiri family names live in the Quran/Dua theme facade (itself a thin
// layer over ../../theme), which is where every Arabic run in this app
// gets its font from.
import { fonts } from '../../components/islamicTheme';

export default function LoginScreen() {
  const router          = useRouter();
  const setAuth         = useAuthStore((s) => s.setAuth);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);

  // Seeded when the user arrives here from the verify-phone screen after
  // finding out their number already has an account — no point making
  // them type it a second time.
  const params = useLocalSearchParams();
  const seededPhone = typeof params.phone === 'string' ? params.phone : '';

  const [phone,    setPhone]    = useState(seededPhone);
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  // Inline error shown under the sign-in button. The backend returns
  // genuinely useful copy here — "Your account is still pending
  // approval", "Your account registration was rejected", "Invalid phone
  // or password" — which used to be trapped in a dismissible Alert the
  // user could tap away before reading. Keeping it on-screen also lets
  // them re-read it while correcting the field.
  const [formError, setFormError] = useState(null);
  // Set when the backend answers NO_ACCOUNT_FOUND — the phone simply has
  // no account, including the case where one was deleted (deletion leaves
  // nothing behind, so it is indistinguishable from a number never used).
  // The only useful next step is registering, so we put that right in the
  // error banner rather than making them hunt for the footer link.
  const [noAccount, setNoAccount] = useState(false);

  const handleGuest = async () => {
    await continueAsGuest();
    router.replace('/(user)');
  };

  const handleLogin = async () => {
    setFormError(null);
    setNoAccount(false);
    if (!phone)    return setFormError('Enter your phone number to sign in.');
    if (!password) return setFormError('Enter your password to sign in.');

    setLoading(true);
    try {
      const response = await authApi.login({ phone: phone.trim(), password });
      const { accessToken, refreshToken, active_role, available_roles, profile } = response.data;
      await setAuth(profile, accessToken, refreshToken, active_role, available_roles);

      if (active_role === 'super_admin') router.replace('/super-admin/superadmin-dashboard');
      else if (active_role === 'admin') router.replace('/(admin)');
      else router.replace('/(user)');
    } catch (err) {
      // No network response at all reads differently from a rejected
      // credential — say so rather than blaming the password.
      const serverMessage = err?.response?.data?.message;
      setNoAccount(err?.response?.data?.code === 'NO_ACCOUNT_FOUND');
      setFormError(
        serverMessage ||
        (err?.response
          ? 'Check your phone and password and try again.'
          : "Couldn't reach the server. Check your connection and try again.")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAwareScroll contentContainerStyle={styles.scroll}>
          {/* Brand block */}
          <View style={styles.brand}>
            <View style={styles.brandDotRow}>
              <View style={styles.brandDot} />
              <Text style={styles.brandName}>OneMessage</Text>
            </View>
            {/* Ornament divider — the hairline gold rule bracketing a ۞,
                the same section break used by Hero, verify-phone,
                register and Calendar. Here it separates the wordmark
                from the shahada beneath it. */}
            <View style={styles.brandRule}>
              <View style={styles.brandRuleLine} />
              <RubStar size={13} />
              <View style={styles.brandRuleLine} />
            </View>

            {/* Shahada — Arabic above, meaning below, the pairing the Dua
                and Qur'an screens already use. Hand-typed Arabic in this
                codebase is plain unvocalised script (cf. the namaz names
                in PrayerWidget); only API-sourced text carries harakat. */}
            <Text style={styles.shahada} accessibilityLanguage="ar">
              لا إله إلا الله
            </Text>
            <Text style={styles.tagline}>
              <Text style={styles.taglineTranslit}>La ilaha illallah</Text>
              {' — there is no God except Allah.'}
            </Text>
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
                onChangeText={(v) => { setPhone(v.replace(/\D/g, '')); setFormError(null); setNoAccount(false); }}
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
                onChangeText={(v) => { setPassword(v); setFormError(null); setNoAccount(false); }}
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

            {formError ? (
              <View
                style={styles.errorBanner}
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
              >
                <Ionicons name="alert-circle" size={16} color={colors.danger} />
                <View style={styles.errorBody}>
                  <Text style={styles.errorText}>{formError}</Text>
                  {noAccount ? (
                    <Pressable
                      onPress={() => router.push({
                        pathname: '/(auth)/verify-phone',
                        params: phone ? { phone } : {},
                      })}
                      hitSlop={8}
                      style={({ pressed }) => pressed && { opacity: 0.6 }}
                    >
                      <Text style={styles.errorAction}>Create an account</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Secondary but prominent, and deliberately above the "or":
                registering is the second-most-likely reason someone opens
                this screen, so it belongs with the sign-in action rather
                than down among the alternatives. */}
            <Pressable
              onPress={() => router.push('/(auth)/verify-phone')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Create a new account"
              style={({ pressed }) => [styles.createRow, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.createText}>
                New here? <Text style={styles.createAction}>Create an account</Text>
              </Text>
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <Button
              label="Continue as guest"
              variant="ghost"
              icon="footsteps-outline"
              onPress={handleGuest}
              fullWidth
            />

            <Button
              label="I'm delivering today"
              variant="secondary"
              icon="bicycle-outline"
              onPress={() => router.push('/(rider)/login')}
              fullWidth
              style={styles.riderBtn}
            />
          </View>
      </KeyboardAwareScroll>
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

  // Gold Amiri is this app's treatment for short sacred Arabic (see the
  // namaz names in PrayerWidget). ARABIC_TEXT_STYLE is not spread here
  // because it pins textAlign:'right' for left-aligned body copy — the
  // brand block is a centred column, so only the parts that carry bidi
  // correctness (family + writingDirection) are kept.
  shahada: {
    fontFamily: fonts.arabic,
    fontSize: 26,
    lineHeight: 40,
    color: colors.gold,
    textAlign: 'center',
    writingDirection: 'rtl',
    marginTop: space[3],
    includeFontPadding: false,
  },
  tagline:      { ...type.meta, marginTop: space[1], textAlign: 'center' },
  // Italic transliteration, plain translation — the same distinction the
  // dua detail screen draws between the two.
  taglineTranslit: { fontStyle: 'italic', color: colors.inkMuted },

  form:         { marginBottom: space[6] },
  formTitle:    { ...type.h1 },
  formSubtitle: { ...type.meta, marginTop: space[1], marginBottom: space[5] },

  field:  { marginBottom: space[3] },
  label:  { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },

  forgotWrap: { alignSelf: 'flex-end', marginTop: space[1], marginBottom: space[4] },
  forgot:     { ...type.meta, color: colors.teal, fontWeight: '700' },

  primaryBtn: { marginTop: space[2] },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    marginTop: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  // The banner is a row (icon + body); the body stacks the message above
  // an optional action, so the flex lives here rather than on the text.
  errorBody: { flex: 1, gap: space[2] },
  errorText: { ...type.meta, color: colors.danger, fontWeight: '600', lineHeight: 18 },
  // Kept in the danger colour rather than the usual teal — teal on the
  // soft-red banner reads as decoration, not as the way out.
  errorAction: {
    ...type.meta,
    color: colors.danger,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', gap: space[3], marginVertical: space[5] },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.ruleSoft },
  dividerText: { ...type.meta, color: colors.inkFaint },

  // Gap between the two alternatives. Carried by the second button in
  // the stack; the first needs none, since dividerRow's marginVertical
  // already separates it from the "or".
  riderBtn:     { marginTop: space[2] },

  // paddingVertical + the 22px line box gives a 46px target. tealDark
  // rather than teal: 5.2:1 on this background instead of 3.6:1, and it
  // is the token the app already uses for action links (PrayerWidget's
  // "View all prayers").
  createRow:    { alignItems: 'center', paddingVertical: space[3], marginTop: space[2] },
  createText:   { ...type.body, color: colors.inkFaint },
  createAction: { color: colors.tealDark, fontWeight: '700' },
});
