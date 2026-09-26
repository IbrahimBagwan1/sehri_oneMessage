import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authApi } from '../../api/auth';
import ResendOtpButton from '../../components/ResendOtpButton';
import { Button, Header, Input, RubStar, KeyboardAwareScroll } from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Step 1 of registration — prove you own the phone number.
//
// Registration used to be one long screen where phone, OTP, identity and
// location all lived together; a user could fill in everything and only
// then discover their code was wrong. Splitting verification out means
// the number is confirmed before any of that work is asked for.
//
// On success the backend returns a short-lived `verification_token`
// (15 min) which we hand to the registration form via route params. The
// form submits that instead of the OTP, because verifying the code
// consumes it server-side — see backend otpController.
//
// The OTP length is read from the send-otp response rather than
// hardcoded: the local dev generator and the SMS provider are both
// pinned to the same length server-side, and this screen just follows
// whatever the server says.
// -----------------------------------------------------------------------------

const STEP = { PHONE: 'phone', CODE: 'code' };

export default function VerifyPhoneScreen() {
  const router = useRouter();
  const otpInputRef = useRef(null);

  const [step, setStep]         = useState(STEP.PHONE);
  const [phone, setPhone]       = useState('');
  const [otp, setOtp]           = useState('');
  const [otpLength, setOtpLength] = useState(6);
  const [sending, setSending]   = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [formError, setFormError] = useState(null);
  // Distinct from formError: "this number already has an account" is a
  // dead end with a specific way out (sign in), not a mistake to correct
  // in place. It gets its own state so it can render a recovery card
  // with actions rather than a red validation line.
  const [takenMessage, setTakenMessage] = useState(null);

  /**
   * Route an API failure to the right piece of UI.
   *
   * Branches on the server's machine-readable `code` rather than matching
   * the message text, so rewording the copy backend-side can't silently
   * turn the recovery card back into a generic error.
   */
  const handleApiError = (err, fallback) => {
    const body = err?.response?.data;
    if (body?.code === 'PHONE_ALREADY_REGISTERED') {
      setFormError(null);
      setTakenMessage(body.message || 'An account with this number already exists.');
      return;
    }
    setTakenMessage(null);
    setFormError(
      body?.message ||
      (err?.response
        ? fallback
        : "Couldn't reach the server. Check your connection and try again.")
    );
  };

  const clearErrors = () => {
    setFormError(null);
    setTakenMessage(null);
  };

  // Carry the number over so a returning user isn't retyping it on the
  // sign-in screen they were just redirected to.
  const goToLogin = () => {
    router.replace({ pathname: '/(auth)/login', params: { phone } });
  };

  // Focus the code field as soon as we move to step 2 — one less tap.
  useEffect(() => {
    if (step === STEP.CODE) {
      const t = setTimeout(() => otpInputRef.current?.focus?.(), 350);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [step]);

  const handleSend = async () => {
    clearErrors();
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return setFormError("That doesn't look like a valid 10-digit Indian mobile number.");
    }
    setSending(true);
    try {
      const res = await authApi.sendOtp(phone, 'registration');
      // Server tells us how many digits to expect — never hardcode it.
      const len = res?.data?.otpLength;
      if (Number.isFinite(len) && len > 0) setOtpLength(len);
      setOtp('');
      setStep(STEP.CODE);
    } catch (err) {
      // A taken number is rejected here, before any SMS is sent — the
      // user never advances to the code step for a dead-end number.
      handleApiError(err, "Couldn't send the code. Try again in a moment.");
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    clearErrors();
    if (otp.trim().length < 4) {
      return setFormError('Enter the code we sent you.');
    }
    setVerifying(true);
    try {
      const res = await authApi.verifyPhone({ phone, otp: otp.trim() });
      const token = res?.data?.verification_token;
      if (!token) {
        return setFormError('Verification failed. Request a new code and try again.');
      }
      // Hand the verified phone + ticket to the registration form.
      router.replace({
        pathname: '/(auth)/register',
        params: { phone, verification_token: token },
      });
    } catch (err) {
      // Also covers the race where the number got claimed between
      // requesting the code and entering it.
      handleApiError(err, 'That code is incorrect or has expired. Request a new one.');
    } finally {
      setVerifying(false);
    }
  };

  const changeNumber = () => {
    setStep(STEP.PHONE);
    setOtp('');
    clearErrors();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header
        title="Verify your number"
        onBack={() => (step === STEP.CODE ? changeNumber() : router.back())}
      />

      <KeyboardAwareScroll contentContainerStyle={styles.scroll}>
          {/* Step indicator — makes it obvious this is 1 of 2 */}
          <View style={styles.stepper}>
            <View style={styles.stepDotActive}>
              <Text style={styles.stepDotTextActive}>1</Text>
            </View>
            <View style={styles.stepLine} />
            <View style={styles.stepDot}>
              <Text style={styles.stepDotText}>2</Text>
            </View>
          </View>
          <Text style={styles.stepCaption}>
            Step 1 of 2 · Verify phone{'  '}›{'  '}Your details
          </Text>

          <View style={styles.ornamentRow}>
            <View style={styles.ornamentRule} />
            <RubStar size={12} />
            <View style={styles.ornamentRule} />
          </View>

          {step === STEP.PHONE ? (
            <>
              <Text style={styles.title}>What's your number?</Text>
              <Text style={styles.subtitle}>
                We'll text you a code to confirm it's really you. This is the
                number you'll sign in with.
              </Text>

              <View style={styles.field}>
                <Text style={styles.label}>Phone number</Text>
                <Input
                  placeholder="10-digit mobile number"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={(v) => { setPhone(v.replace(/\D/g, '')); clearErrors(); }}
                  maxLength={10}
                  icon="call-outline"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  returnKeyType="send"
                  onSubmitEditing={handleSend}
                />
              </View>

              {takenMessage ? (
                <AccountExistsCard message={takenMessage} onLogin={goToLogin} />
              ) : formError ? (
                <ErrorBanner message={formError} />
              ) : null}

              <Button
                label="Send code"
                onPress={handleSend}
                loading={sending}
                disabled={phone.length !== 10 || !!takenMessage}
                fullWidth
                icon="paper-plane-outline"
                style={styles.primaryBtn}
              />
            </>
          ) : (
            <>
              <Text style={styles.title}>Enter the code</Text>
              <Text style={styles.subtitle}>
                We sent a {otpLength}-digit code to{' '}
                <Text style={styles.subtitleStrong}>+91 {phone}</Text>.
              </Text>

              <Pressable
                onPress={changeNumber}
                hitSlop={8}
                style={({ pressed }) => [styles.changeRow, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="Change phone number"
              >
                <Ionicons name="create-outline" size={14} color={colors.teal} />
                <Text style={styles.changeText}>Change number</Text>
              </Pressable>

              <View style={styles.field}>
                <Text style={styles.label}>Verification code</Text>
                <Input
                  ref={otpInputRef}
                  placeholder={`${otpLength}-digit code`}
                  keyboardType="number-pad"
                  value={otp}
                  onChangeText={(v) => { setOtp(v.replace(/\D/g, '')); clearErrors(); }}
                  maxLength={otpLength}
                  icon="lock-closed-outline"
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  returnKeyType="done"
                  onSubmitEditing={handleVerify}
                />
                <ResendOtpButton onResend={() => authApi.sendOtp(phone, 'registration')} />
              </View>

              {takenMessage ? (
                <AccountExistsCard message={takenMessage} onLogin={goToLogin} />
              ) : formError ? (
                <ErrorBanner message={formError} />
              ) : null}

              <Button
                label="Verify and continue"
                onPress={handleVerify}
                loading={verifying}
                disabled={otp.length < 4 || !!takenMessage}
                fullWidth
                icon="checkmark-circle-outline"
                style={styles.primaryBtn}
              />
            </>
          )}

          <Pressable
            onPress={() => router.replace('/(auth)/login')}
            hitSlop={8}
            style={({ pressed }) => [styles.footer, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.footerText}>
              Already have an account? <Text style={styles.footerAction}>Sign in</Text>
            </Text>
          </Pressable>
      </KeyboardAwareScroll>
    </SafeAreaView>
  );
}

function ErrorBanner({ message }) {
  return (
    <View style={styles.errorBanner} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Ionicons name="alert-circle" size={16} color={colors.danger} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

/**
 * Shown when the number already has an account.
 *
 * Deliberately NOT styled as a red error: the person hasn't done
 * anything wrong, they're just on the wrong screen. Warm gold reads as
 * "here's where you actually want to go" rather than "you failed", and
 * the primary action takes them straight there with the number already
 * carried across.
 */
function AccountExistsCard({ message, onLogin }) {
  return (
    <View
      style={styles.existsCard}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View style={styles.existsHeadRow}>
        <View style={styles.existsIcon}>
          <Ionicons name="person-circle-outline" size={20} color={colors.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.existsTitle}>You already have an account</Text>
          <Text style={styles.existsBody}>{message}</Text>
        </View>
      </View>

      <Button
        label="Log in instead"
        onPress={onLogin}
        icon="log-in-outline"
        fullWidth
        style={styles.existsAction}
      />
      <Text style={styles.existsHint}>
        Using a different number? Edit it above and try again.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { padding: space[5], paddingBottom: space[10] },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    marginTop: space[2],
  },
  stepDot: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.ruleSoft,
    backgroundColor: colors.paper,
  },
  stepDotActive: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.teal,
  },
  stepDotText:       { ...type.micro, color: colors.inkFaint, fontWeight: '800' },
  stepDotTextActive: { ...type.micro, color: colors.paper, fontWeight: '800' },
  stepLine:          { width: 40, height: 2, backgroundColor: colors.ruleSoft },
  stepCaption: {
    ...type.micro,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: space[2],
  },

  ornamentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[4],
    marginBottom: space[5],
  },
  ornamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },

  title:    { ...type.h1 },
  subtitle: { ...type.body, color: colors.inkMuted, marginTop: space[2], lineHeight: 22 },
  subtitleStrong: { fontWeight: '800', color: colors.ink },

  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: space[2] },
  changeText: { ...type.meta, color: colors.teal, fontWeight: '700' },

  field: { marginTop: space[5] },
  label: { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },

  primaryBtn: { marginTop: space[5] },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    marginTop: space[4],
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { ...type.meta, color: colors.danger, flex: 1, fontWeight: '600', lineHeight: 18 },

  // "Account already exists" recovery card — warm/gold, not red.
  existsCard: {
    marginTop: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  existsHeadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  existsIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.goldBorder,
  },
  existsTitle:  { ...type.bodyStrong, color: colors.ink },
  existsBody:   { ...type.meta, color: colors.inkMuted, marginTop: 3, lineHeight: 19 },
  existsAction: { marginTop: space[4] },
  existsHint:   { ...type.micro, color: colors.inkFaint, textAlign: 'center', marginTop: space[3] },

  footer:       { alignItems: 'center', paddingVertical: space[5] },
  footerText:   { ...type.body, color: colors.inkFaint },
  footerAction: { color: colors.teal, fontWeight: '700' },
});
