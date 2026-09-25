import React, { useState, useEffect } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authApi } from '../../api/auth';
import LocationPicker from '../../components/LocationPicker';
import PasswordInput from '../../components/PasswordInput';
import { Button, Header, Input, RubStar } from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Step 2 of registration — identity + location.
//
// Phone verification happens BEFORE this screen, on (auth)/verify-phone.
// We arrive here with `phone` (already proven) and `verification_token`
// (a short-lived ticket the backend accepts in place of the OTP, since
// verifying the code consumes it). If someone lands here without a
// ticket we bounce them back rather than showing a form they can't submit.
//
// Location uses the shared cascading LocationPicker (City → Region →
// Area → Zone → PG), which walks whatever hierarchy the backend actually
// has rather than assuming a fixed depth.
// -----------------------------------------------------------------------------

const GENDERS = [
  { value: 'male',   label: 'Male'   },
  { value: 'female', label: 'Female' },
];

const OCCUPATIONS = [
  { value: 'student',  label: 'Student'  },
  { value: 'employee', label: 'Employee' },
  { value: 'others',   label: 'Other'    },
];

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const verifiedPhone     = typeof params.phone === 'string' ? params.phone : '';
  const verificationToken = typeof params.verification_token === 'string'
    ? params.verification_token
    : '';

  const [name, setName]             = useState('');
  const [password, setPassword]     = useState('');
  const [gender, setGender]         = useState('');
  const [occupation, setOccupation] = useState('');
  const [landmark, setLandmark]     = useState('');
  const city = 'Bangalore';

  // Deepest node the cascading picker landed on — this is what
  // users.location_id stores.
  const [location, setLocation] = useState(null); // { id, name, chain, isLeaf }

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState(null);

  // Guard: this screen is only reachable with a verified phone. Anyone
  // deep-linking straight here gets sent to step 1 instead of a form
  // whose submit is guaranteed to fail.
  useEffect(() => {
    if (!verifiedPhone || !verificationToken) {
      router.replace('/(auth)/verify-phone');
    }
  }, [verifiedPhone, verificationToken, router]);

  const handleRegister = async () => {
    setFormError(null);

    if (!name.trim())      return setFormError('Enter your full name.');
    if (password.length < 6) return setFormError('Your password needs at least 6 characters.');
    if (!gender)           return setFormError('Select your gender.');
    if (!occupation)       return setFormError('Select your occupation.');
    if (!location?.id)     return setFormError('Pick your location, right down to your PG.');
    // Delivery routing resolves a zone by walking up from location_id,
    // so a selection that stops above the zone level can never route.
    if (!location.hasZone) {
      return setFormError(
        `No delivery zones are set up under ${location.name} yet. Pick a different one, or ask an admin to add your PG.`
      );
    }

    setSubmitting(true);
    try {
      await authApi.register({
        name: name.trim(),
        phone: verifiedPhone,
        password,
        gender,
        occupation,
        city,
        location_id: location.id,
        // The backend requires a non-empty `address`. Prefer the
        // resident's own landmark text; fall back to the PG name so the
        // field is never blank for someone who skipped the optional box.
        address: landmark.trim() || location.name,
        verification_token: verificationToken,
      });
      Alert.alert(
        'Account created',
        "Your account is pending admin approval. You'll be able to sign in once it's approved.",
        [{ text: 'Go to sign-in', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch (err) {
      const msg = err?.response?.data?.message;
      // An expired ticket is recoverable — send them back to re-verify
      // rather than leaving them stuck on a form that won't submit.
      if (err?.response?.status === 400 && msg && /verification expired/i.test(msg)) {
        return Alert.alert(
          'Verification expired',
          'Your phone verification timed out. Verify your number again to continue.',
          [{ text: 'Verify again', onPress: () => router.replace('/(auth)/verify-phone') }]
        );
      }
      setFormError(
        msg ||
        (err?.response
          ? "Couldn't create your account. Try again in a moment."
          : "Couldn't reach the server. Check your connection and try again.")
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Render nothing while the guard redirect is in flight.
  if (!verifiedPhone || !verificationToken) return null;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Your details" onBack={() => router.back()} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Step indicator — mirrors verify-phone so the flow reads as one journey */}
          <View style={styles.stepper}>
            <View style={styles.stepDotDone}>
              <Ionicons name="checkmark" size={14} color={colors.paper} />
            </View>
            <View style={styles.stepLineDone} />
            <View style={styles.stepDotActive}>
              <Text style={styles.stepDotTextActive}>2</Text>
            </View>
          </View>
          <Text style={styles.stepCaption}>Step 2 of 2 · Your details</Text>

          {/* Verified phone — shown as a confirmed, immutable fact */}
          <View style={styles.verifiedCard}>
            <View style={styles.verifiedIcon}>
              <Ionicons name="shield-checkmark" size={18} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.verifiedLabel}>Verified number</Text>
              <Text style={styles.verifiedPhone}>+91 {verifiedPhone}</Text>
            </View>
            <Pressable
              onPress={() => router.replace('/(auth)/verify-phone')}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
              accessibilityRole="button"
              accessibilityLabel="Change phone number"
            >
              <Text style={styles.verifiedChange}>Change</Text>
            </Pressable>
          </View>

          {/* Identity */}
          <SectionTitle>Your identity</SectionTitle>

          <View style={styles.field}>
            <Text style={styles.label}>Full name</Text>
            <Input
              value={name}
              onChangeText={(v) => { setName(v); setFormError(null); }}
              placeholder="e.g. Ayesha Siddiqua"
              autoCapitalize="words"
              icon="person-outline"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <PasswordInput
              placeholder="At least 6 characters"
              value={password}
              onChangeText={(v) => { setPassword(v); setFormError(null); }}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Gender</Text>
            <ChoiceRow options={GENDERS} value={gender} onChange={(v) => { setGender(v); setFormError(null); }} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Occupation</Text>
            <ChoiceRow options={OCCUPATIONS} value={occupation} onChange={(v) => { setOccupation(v); setFormError(null); }} />
          </View>

          {/* Location */}
          <View style={styles.ornamentRow}>
            <View style={styles.ornamentRule} />
            <RubStar size={12} />
            <View style={styles.ornamentRule} />
          </View>

          <SectionTitle>Where you'll receive Sehri</SectionTitle>
          <Text style={styles.helper}>
            Pick your location step by step, right down to your PG. The rider
            delivers to the PG's pin, so this needs to be exact.
          </Text>

          <LocationPicker
            value={location?.id}
            onChange={(picked) => { setLocation(picked); setFormError(null); }}
          />

          <View style={styles.field}>
            <Text style={styles.label}>
              Building / flat / landmark <Text style={styles.optional}>· optional</Text>
            </Text>
            <Input
              value={landmark}
              onChangeText={setLandmark}
              placeholder="e.g. 2nd floor, room 4"
              multiline
            />
            <Text style={styles.fieldHint}>
              Helps the rider find you inside the building.
            </Text>
          </View>

          {formError ? (
            <View style={styles.errorBanner} accessibilityLiveRegion="polite" accessibilityRole="alert">
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{formError}</Text>
            </View>
          ) : null}

          <Button
            label="Create account"
            onPress={handleRegister}
            loading={submitting}
            fullWidth
            icon="checkmark-circle-outline"
            style={styles.submitBtn}
          />

          <Pressable
            onPress={() => router.replace('/(auth)/login')}
            hitSlop={8}
            style={({ pressed }) => [styles.footer, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.footerText}>
              Already have an account? <Text style={styles.footerAction}>Sign in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// Local helpers
// -----------------------------------------------------------------------------

function SectionTitle({ children, style }) {
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

function ChoiceRow({ options, value, onChange }) {
  return (
    <View style={styles.choiceRow}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.choice,
              active && styles.choiceActive,
              pressed && !active && styles.choicePressed,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
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
    marginTop: space[1],
  },
  stepDotDone: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.success,
  },
  stepDotActive: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.teal,
  },
  stepDotTextActive: { ...type.micro, color: colors.paper, fontWeight: '800' },
  stepLineDone:      { width: 40, height: 2, backgroundColor: colors.success },
  stepCaption: {
    ...type.micro, color: colors.inkFaint,
    textAlign: 'center', marginTop: space[2], marginBottom: space[4],
  },

  verifiedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.success,
    marginBottom: space[6],
  },
  verifiedIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  verifiedLabel:  { ...type.micro, color: colors.success, fontWeight: '700' },
  verifiedPhone:  { ...type.bodyStrong, color: colors.ink, marginTop: 1 },
  verifiedChange: { ...type.meta, color: colors.teal, fontWeight: '700' },

  sectionTitle: { ...type.h2, marginBottom: space[3] },
  helper:       { ...type.meta, marginBottom: space[4], marginTop: -space[2] },

  ornamentRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    marginTop: space[3], marginBottom: space[5],
  },
  ornamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },

  field: { marginBottom: space[4] },
  label: { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },
  optional:  { color: colors.inkGhost, fontWeight: '500' },
  fieldHint: { ...type.micro, color: colors.inkFaint, marginTop: space[2] },

  choiceRow: { flexDirection: 'row', gap: space[2] },
  choice: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    alignItems: 'center',
  },
  choiceActive:  { backgroundColor: colors.teal, borderColor: colors.teal },
  choicePressed: { backgroundColor: colors.tealSoft },
  choiceLabel:   { ...type.body, fontWeight: '600', color: colors.inkMuted },
  choiceLabelActive: { color: colors.paper },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    marginTop: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  errorText: { ...type.meta, color: colors.danger, flex: 1, fontWeight: '600', lineHeight: 18 },

  submitBtn: { marginTop: space[4] },

  footer:       { alignItems: 'center', paddingVertical: space[4] },
  footerText:   { ...type.body, color: colors.inkFaint },
  footerAction: { color: colors.teal, fontWeight: '700' },
});
