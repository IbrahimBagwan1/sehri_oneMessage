// @ts-nocheck
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { trackingApi } from '../../api/tracking';
import { useRiderStore } from '../../store/useRiderStore';
import PasswordInput from '../../components/PasswordInput';
import KeyboardAwareScroll from '../../components/ui/KeyboardAwareScroll';

export default function RiderLoginScreen() {
  const router       = useRouter();
  const setRiderAuth = useRiderStore((state) => state.setRiderAuth);

  const passwordRef = React.useRef(null);
  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleLogin = async () => {
    if (!phone.trim()) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }
    if (!password) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    setLoading(true);
    try {
      // Strip whitespace and any newline characters the keyboard may have added
      const cleanPhone = phone.trim().replace(/\D/g, '');
      const response = await trackingApi.riderLogin(cleanPhone, password);
      const { accessToken, refreshToken, profile } = response.data;

      await setRiderAuth(profile, accessToken, refreshToken);

      // Replace so back button doesn't return to login
      router.replace('/(rider)/map');
    } catch (err) {
      const msg = err.response?.data?.message || 'Login failed. Check your credentials.';
      Alert.alert('Login Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAwareScroll contentContainerStyle={styles.scrollContent}>
        {/* Brand block — the app logo, matching the wordmark treatment on
            the main sign-in screen so riders land somewhere that clearly
            belongs to OneMessage rather than a generic bicycle glyph. */}
        <View style={styles.brand}>
          <Image
            source={require('../../../assets/images/icon.png')}
            style={styles.logo}
            resizeMode="contain"
            accessible
            accessibilityRole="image"
            accessibilityLabel="OneMessage"
          />
          <View style={styles.brandNameRow}>
            <View style={styles.brandDot} />
            <Text style={styles.brandName}>OneMessage</Text>
          </View>
          <View style={styles.brandRule}>
            <View style={styles.brandRuleLine} />
            <Ionicons name="bicycle" size={13} color="#B8860B" />
            <View style={styles.brandRuleLine} />
          </View>
        </View>

        <Text style={styles.title}>Rider sign-in</Text>
        <Text style={styles.subtitle}>Sign in to see today's delivery route</Text>

        {/* Phone */}
        <Text style={styles.label}>Phone Number</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your phone number"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={(val) => setPhone(val.replace(/\D/g, ''))}
          maxLength={10}
          autoComplete="tel"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />

        {/* Password */}
        <Text style={styles.label}>Password</Text>
        <PasswordInput
          ref={passwordRef}
          placeholder="Enter your password"
          value={password}
          onChangeText={setPassword}
          returnKeyType="done"
          onSubmitEditing={handleLogin}
        />

        {/* Login Button */}
        <TouchableOpacity
          style={[styles.loginButton, loading && styles.loginButtonDisabled]}
          onPress={handleLogin}
          disabled={loading}
          accessibilityLabel="Login as rider"
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.loginButtonText}>Login</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.note}>
          Your login credentials are set by the coordinator.{'\n'}
          Contact them if you have trouble logging in.
        </Text>

    </KeyboardAwareScroll>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 12,
  },
  brandNameRow: { flexDirection: 'row', alignItems: 'center' },
  brandDot: {
    width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: '#0D9488',
    marginRight: 8,
  },
  brandName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  brandRule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    width: 150,
  },
  brandRuleLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E8D8A8',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    marginTop: 14,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0F172A',
  },
  loginButton: {
    backgroundColor: '#0D9488',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 28,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  note: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
});