import React, { useState } from 'react';
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
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/useAuthStore';

export default function LoginScreen() {
  const router  = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [phone,    setPhone]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleLogin = async () => {
    if (!phone) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }
    if (!password) {
      Alert.alert('Error', 'Please enter your password');
      return;
    }

    setLoading(true);
    try {
      // Backend auto-detects the highest role — no role param needed
      const response = await authApi.login({ phone, password });
      const { accessToken, refreshToken, active_role, available_roles, profile } = response.data;

      await setAuth(profile, accessToken, refreshToken, active_role, available_roles);

      // Route to the correct home based on the returned active role
      if (active_role === 'super_admin') {
        router.replace('/super-admin/superadmin-dashboard');
      } else if (active_role === 'admin') {
        router.replace('/(admin)');
      } else {
        router.replace('/(user)');
      }
    } catch (error) {
      const msg = error.response?.data?.message || 'Login failed. Please check your credentials.';
      Alert.alert('Login Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>One Message</Text>
        <Text style={styles.subtitle}>Sign in to your account</Text>

        {/* Phone Input */}
        <Text style={styles.label}>Phone Number</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter 10-digit mobile number"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
          maxLength={10}
        />

        {/* Password */}
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {/* Forgot Password */}
        <TouchableOpacity
          style={styles.forgotPasswordContainer}
          onPress={() => router.push('/(auth)/forgot-password')}
        >
          <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
        </TouchableOpacity>

        {/* Login Button */}
        <TouchableOpacity
          style={styles.submitButton}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitText}>Login</Text>
          )}
        </TouchableOpacity>

        {/* Rider Login */}
        <TouchableOpacity
          style={styles.riderLink}
          onPress={() => router.push('/(rider)/login')}
        >
          <Text style={styles.riderLinkText}>Delivering today? <Text style={styles.riderLinkBold}>Rider login</Text></Text>
        </TouchableOpacity>

        {/* Register Link */}
        <TouchableOpacity
          style={styles.registerLink}
          onPress={() => router.push('/(auth)/register')}
        >
          <Text style={styles.registerText}>
            {" Don't have an account?"} <Text style={styles.boldText}>Register</Text>
          </Text>
        </TouchableOpacity>

        {/* About */}
        <View style={styles.aboutContainer}>
          <Text style={styles.aboutTitle}>About One Message</Text>
          <Text style={styles.aboutDescription}>
            One Message is a unified platform designed to streamline messaging and
            administrative access for Users, Admins, and Super Admins.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  scrollContent: { padding: 24, justifyContent: 'center', flexGrow: 1 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1E293B', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  forgotPasswordContainer: { alignSelf: 'flex-end', marginBottom: 20, marginTop: 8 },
  forgotPasswordText: { color: '#2563EB', fontSize: 14, fontWeight: '500' },
  submitButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 4,
  },
  submitText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  riderLink: { marginTop: 16, alignItems: 'center' },
  riderLinkText: { color: '#94A3B8', fontSize: 13 },
  riderLinkBold: { color: '#0D9488', fontWeight: '600' },
  registerLink: { marginTop: 8, alignItems: 'center' },
  registerText: { color: '#64748B', fontSize: 14 },
  boldText: { color: '#2563EB', fontWeight: 'bold' },
  aboutContainer: { marginTop: 24, paddingHorizontal: 16, alignItems: 'center' },
  aboutTitle: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 4 },
  aboutDescription: { fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
});
