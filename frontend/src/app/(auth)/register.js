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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { authApi, locationsApi } from '../../api/auth';
import PasswordInput from '../../components/PasswordInput';
import ResendOtpButton from '../../components/ResendOtpButton';
import { Button, Card, Chip, Header, Input, LoadingState } from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// One-screen registration: phone → OTP → identity → location.
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

  const [name, setName]         = useState('');
  const [phone, setPhone]       = useState('');
  const [password, setPassword] = useState('');
  const [gender, setGender]         = useState('');
  const [occupation, setOccupation] = useState('');
  const [otp, setOtp] = useState('');
  const city = 'Bangalore';

  const [zones, setZones]                     = useState([]);
  const [addresses, setAddresses]             = useState([]);
  const [selectedZone, setSelectedZone]       = useState(null);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const zoneHasAddresses = addresses.length > 0;
  const locationId  = zoneHasAddresses ? selectedAddress?.id : selectedZone?.id;
  const addressLabel = zoneHasAddresses ? selectedAddress?.name : selectedZone?.name;

  const [otpSent, setOtpSent]                 = useState(false);
  const [loadingOtp, setLoadingOtp]           = useState(false);
  const [loadingZones, setLoadingZones]       = useState(true);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [submitting, setSubmitting]           = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch {
        Alert.alert("Couldn't load zones", 'Restart the app and try again.');
      } finally {
        setLoadingZones(false);
      }
    })();
  }, []);

  const handleZoneSelect = async (zone) => {
    setSelectedZone(zone);
    setSelectedAddress(null);
    setAddresses([]);
    setLoadingAddresses(true);
    try {
      const res = await locationsApi.getLocations({ type: 'address', parent_id: zone.id });
      setAddresses(res.data || []);
    } catch {
      Alert.alert("Couldn't load addresses", 'Try picking a different zone or restart the app.');
    } finally {
      setLoadingAddresses(false);
    }
  };

  const handleSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return Alert.alert('Check the number', 'That doesn\'t look like a valid 10-digit Indian mobile number.');
    }
    setLoadingOtp(true);
    try {
      await authApi.sendOtp(phone, 'registration');
      setOtpSent(true);
      Alert.alert('OTP sent', 'Enter the 6-digit code we just sent to your phone.');
    } catch (err) {
      Alert.alert("Couldn't send OTP", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setLoadingOtp(false);
    }
  };

  const handleRegister = async () => {
    if (!name || !phone || !password || !gender || !occupation || !otp || !locationId) {
      return Alert.alert('A few things missing', 'Fill in every field and pick your location.');
    }
    if (!otpSent) return Alert.alert('OTP first', 'Send and enter the OTP before registering.');

    setSubmitting(true);
    try {
      await authApi.register({
        name, phone, password, gender, occupation, city,
        location_id: locationId, address: addressLabel, otp,
      });
      Alert.alert(
        'Account created',
        'Your account is pending admin approval. You\'ll be able to sign in once it\'s approved.',
        [{ text: 'Go to sign-in', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch (err) {
      Alert.alert("Couldn't create account", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Create account" onBack={() => router.back()} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Identity */}
          <SectionTitle>Your identity</SectionTitle>
          <View style={styles.field}>
            <Text style={styles.label}>Full name</Text>
            <Input value={name} onChangeText={setName} placeholder="e.g. Ayesha Siddiqua" icon="person-outline" />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Phone number</Text>
            <View style={styles.phoneRow}>
              <View style={{ flex: 1 }}>
                <Input
                  placeholder="10-digit mobile"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={(v) => { setPhone(v.replace(/\D/g, '')); setOtpSent(false); }}
                  maxLength={10}
                  editable={!otpSent}
                  icon="call-outline"
                />
              </View>
              <Button
                label={otpSent ? 'Sent' : 'Send OTP'}
                onPress={handleSendOtp}
                loading={loadingOtp}
                variant={otpSent ? 'ghost' : 'primary'}
                size="sm"
                disabled={otpSent}
                style={styles.phoneAction}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>OTP code</Text>
            <Input
              placeholder="6-digit code"
              keyboardType="number-pad"
              value={otp}
              onChangeText={setOtp}
              maxLength={6}
              editable={otpSent}
              icon="lock-closed-outline"
            />
            {otpSent && (
              <ResendOtpButton onResend={() => authApi.sendOtp(phone, 'registration')} />
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <PasswordInput placeholder="At least 6 characters" value={password} onChangeText={setPassword} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Gender</Text>
            <ChoiceRow options={GENDERS} value={gender} onChange={setGender} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Occupation</Text>
            <ChoiceRow options={OCCUPATIONS} value={occupation} onChange={setOccupation} />
          </View>

          {/* Location */}
          <SectionTitle style={{ marginTop: space[6] }}>Where you'll receive Sehri</SectionTitle>
          <Text style={styles.helper}>Delivery is coordinated by zone. Pick yours below.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>City</Text>
            <View style={styles.readonlyBox}>
              <Ionicons name="location-outline" size={16} color={colors.inkFaint} />
              <Text style={styles.readonlyText}>{city}</Text>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Zone</Text>
            {loadingZones ? (
              <LoadingState message="Loading zones…" compact />
            ) : (
              <View style={styles.chipWrap}>
                {zones.map((z) => (
                  <Chip
                    key={z.id}
                    label={z.name}
                    tone={selectedZone?.id === z.id ? 'teal' : 'neutral'}
                    selected={selectedZone?.id === z.id}
                    onPress={() => handleZoneSelect(z)}
                    style={styles.pickChip}
                  />
                ))}
              </View>
            )}
          </View>

          {selectedZone && (
            <View style={styles.field}>
              <Text style={styles.label}>PG or hostel</Text>
              {loadingAddresses ? (
                <LoadingState message="Loading options…" compact />
              ) : addresses.length === 0 ? (
                <Text style={styles.hint}>No sub-address needed for {selectedZone.name}.</Text>
              ) : (
                <View style={styles.chipWrap}>
                  {addresses.map((a) => (
                    <Chip
                      key={a.id}
                      label={a.name}
                      tone={selectedAddress?.id === a.id ? 'teal' : 'neutral'}
                      selected={selectedAddress?.id === a.id}
                      onPress={() => setSelectedAddress(a)}
                      style={styles.pickChip}
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          <Button
            label="Create account"
            onPress={handleRegister}
            loading={submitting}
            fullWidth
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

  sectionTitle: { ...type.h2, marginBottom: space[3] },
  helper:       { ...type.meta, marginBottom: space[4], marginTop: -space[2] },
  hint:         { ...type.meta, fontStyle: 'italic' },

  field: { marginBottom: space[4] },
  label: { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },

  phoneRow:    { flexDirection: 'row', gap: space[2], alignItems: 'stretch' },
  phoneAction: { minWidth: 92 },

  readonlyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.ruleFaint,
    paddingHorizontal: space[3],
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
  },
  readonlyText: { ...type.body, color: colors.inkMuted },

  choiceRow: { flexDirection: 'row', gap: space[2] },
  choice: {
    flex: 1,
    paddingVertical: 10,
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

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  pickChip: { paddingHorizontal: space[3], paddingVertical: 6 },

  submitBtn: { marginTop: space[4] },

  footer:       { alignItems: 'center', paddingVertical: space[4] },
  footerText:   { ...type.body, color: colors.inkFaint },
  footerAction: { color: colors.teal, fontWeight: '700' },
});
