import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { authApi, locationsApi } from '../../api/auth';

// ─── Small reusable components ───────────────────────────────────────────────

function Dropdown({ label, value, placeholder, options, onSelect, disabled }) {
  const [open, setOpen] = useState(false);

  if (disabled) {
    return (
      <>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.dropdownPicker, styles.disabledInput]}>
          <Text style={styles.placeholderText}>{placeholder}</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Text style={styles.label}>{label} *</Text>
      <TouchableOpacity
        style={styles.dropdownPicker}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={value ? styles.pickerText : styles.placeholderText}>
          {value || placeholder}
        </Text>
      </TouchableOpacity>
      {open && (
        <View style={styles.dropdownMenu}>
          {options.length === 0 ? (
            <View style={styles.dropdownOption}>
              <Text style={styles.placeholderText}>No options available</Text>
            </View>
          ) : (
            options.map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={styles.dropdownOption}
                onPress={() => {
                  onSelect(opt);
                  setOpen(false);
                }}
              >
                <Text style={styles.optionText}>{opt.name}</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </>
  );
}

function RadioGroup({ label, options, value, onChange }) {
  return (
    <>
      <Text style={styles.label}>{label} *</Text>
      <View style={styles.radioRow}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.radioButton, value === opt.value && styles.radioButtonActive]}
            onPress={() => onChange(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === opt.value }}
          >
            <Text style={[styles.radioText, value === opt.value && styles.radioTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const router = useRouter();

  // ── Form fields (matching backend contract exactly) ──
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [gender, setGender] = useState('');           // 'male' | 'female'
  const [occupation, setOccupation] = useState('');   // 'student' | 'employee' | 'others'
  const [otp, setOtp] = useState('');
  const city = 'Bangalore';                           // fixed, non-editable

  // ── Location picker state ──
  const [zones, setZones] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [selectedZone, setSelectedZone] = useState(null);   // { id, name }
  const [selectedAddress, setSelectedAddress] = useState(null); // { id, name } | null

  // Zones that have address children (Stanza Living) need the user to pick
  // a specific address; others use the zone itself as location_id.
  const zoneHasAddresses = addresses.length > 0;

  // Derived: what gets sent as location_id
  const locationId = zoneHasAddresses ? selectedAddress?.id : selectedZone?.id;
  // address field = the human-readable name of the picked address or zone
  const addressLabel = zoneHasAddresses ? selectedAddress?.name : selectedZone?.name;

  // ── UI state ──
  const [otpSent, setOtpSent] = useState(false);
  const [loadingOtp, setLoadingOtp] = useState(false);
  const [loadingZones, setLoadingZones] = useState(true);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Load zones on mount ──
  useEffect(() => {
    (async () => {
      try {
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch {
        Alert.alert('Error', 'Could not load locations. Please restart the app.');
      } finally {
        setLoadingZones(false);
      }
    })();
  }, []);

  // ── When zone changes, load its address children (if any) ──
  const handleZoneSelect = async (zone) => {
    setSelectedZone(zone);
    setSelectedAddress(null);
    setAddresses([]);
    setLoadingAddresses(true);
    try {
      const res = await locationsApi.getLocations({ type: 'address', parent_id: zone.id });
      setAddresses(res.data || []);
    } catch {
      Alert.alert('Error', 'Could not load addresses for this zone.');
    } finally {
      setLoadingAddresses(false);
    }
  };

  // ── Send OTP ──
  const handleSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      Alert.alert('Error', 'Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    setLoadingOtp(true);
    try {
      await authApi.sendOtp(phone, 'registration');
      setOtpSent(true);
      Alert.alert('OTP Sent', 'Enter the OTP sent to your phone number.');
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to send OTP. Try again.';
      Alert.alert('Error', msg);
    } finally {
      setLoadingOtp(false);
    }
  };

  // ── Submit registration ──
  const handleRegister = async () => {
    if (!name || !phone || !password || !gender || !occupation || !otp || !locationId) {
      Alert.alert('Error', 'Please fill in all required fields and select a location.');
      return;
    }
    if (!otpSent) {
      Alert.alert('Error', 'Please send and enter the OTP first.');
      return;
    }

    setSubmitting(true);
    try {
      await authApi.register({
        name,
        phone,
        password,
        gender,
        occupation,
        city,
        location_id: locationId,
        address: addressLabel,
        otp,
      });

      Alert.alert('Success', 'Account registered! Please wait for admin approval.', [
        { text: 'Go to Login', onPress: () => router.replace('/(auth)/login') },
      ]);
    } catch (err) {
      const msg = err.response?.data?.message || 'Registration failed. Please try again.';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create Account</Text>

        {/* Name */}
        <Text style={styles.label}>Full Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your full name"
          value={name}
          onChangeText={setName}
        />

        {/* Phone + Send OTP */}
        <Text style={styles.label}>Phone Number *</Text>
        <View style={styles.phoneRow}>
          <TextInput
            style={[styles.input, styles.phoneInput]}
            placeholder="10-digit mobile number"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={(t) => { setPhone(t); setOtpSent(false); }}
            maxLength={10}
            editable={!otpSent}
          />
          <TouchableOpacity
            style={[styles.otpButton, otpSent && styles.otpButtonSent]}
            onPress={handleSendOtp}
            disabled={loadingOtp || otpSent}
          >
            {loadingOtp ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.otpButtonText}>{otpSent ? 'Sent ✓' : 'Send OTP'}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* OTP Code */}
        <Text style={styles.label}>OTP Code *</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter OTP from SMS"
          keyboardType="number-pad"
          value={otp}
          onChangeText={setOtp}
          maxLength={6}
          editable={otpSent}
        />

        {/* Password */}
        <Text style={styles.label}>Password *</Text>
        <TextInput
          style={styles.input}
          placeholder="Minimum 6 characters"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {/* Gender */}
        <RadioGroup
          label="Gender"
          value={gender}
          onChange={setGender}
          options={[
            { label: 'Male', value: 'male' },
            { label: 'Female', value: 'female' },
          ]}
        />

        {/* Occupation */}
        <RadioGroup
          label="Occupation"
          value={occupation}
          onChange={setOccupation}
          options={[
            { label: 'Student', value: 'student' },
            { label: 'Employee', value: 'employee' },
            { label: 'Others', value: 'others' },
          ]}
        />

        {/* City (fixed) */}
        <Text style={styles.label}>City</Text>
        <TextInput
          style={[styles.input, styles.disabledInput]}
          value={city}
          editable={false}
        />

        {/* Zone picker */}
        {loadingZones ? (
          <ActivityIndicator style={{ marginTop: 16 }} color="#2563EB" />
        ) : (
          <Dropdown
            label="Zone"
            value={selectedZone?.name}
            placeholder="Select your zone"
            options={zones}
            onSelect={handleZoneSelect}
          />
        )}

        {/* Address picker — only shown when the selected zone has addresses */}
        {selectedZone && loadingAddresses && (
          <ActivityIndicator style={{ marginTop: 12 }} color="#2563EB" />
        )}
        {selectedZone && !loadingAddresses && zoneHasAddresses && (
          <Dropdown
            label="PG / Hostel"
            value={selectedAddress?.name}
            placeholder="Select your PG or hostel"
            options={addresses}
            onSelect={setSelectedAddress}
          />
        )}

        {/* Submit */}
        <TouchableOpacity
          style={styles.submitButton}
          onPress={handleRegister}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitText}>Register</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backText}>Already have an account? Login</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1E293B', textAlign: 'center', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#0F172A',
  },
  disabledInput: { backgroundColor: '#E2E8F0', color: '#64748B' },
  phoneRow: { flexDirection: 'row', gap: 8 },
  phoneInput: { flex: 1 },
  otpButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 90,
  },
  otpButtonSent: { backgroundColor: '#16A34A' },
  otpButtonText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  radioRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  radioButton: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 80,
  },
  radioButtonActive: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  radioText: { fontSize: 13, fontWeight: '600', color: '#64748B' },
  radioTextActive: { color: '#FFF' },
  dropdownPicker: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 12,
  },
  pickerText: { fontSize: 16, color: '#0F172A' },
  placeholderText: { fontSize: 16, color: '#94A3B8' },
  dropdownMenu: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 220,
  },
  dropdownOption: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  optionText: { fontSize: 15, color: '#334155' },
  submitButton: {
    backgroundColor: '#2563EB',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 28,
  },
  submitText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  backLink: { marginTop: 16, alignItems: 'center' },
  backText: { color: '#64748B', fontSize: 14, fontWeight: '500' },
});
