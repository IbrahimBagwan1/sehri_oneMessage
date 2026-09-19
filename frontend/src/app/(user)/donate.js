import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { donationsApi } from '../../api/donations';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Header,
  Input,
  LoadingState,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// DonateScreen — external UPI donation flow, platform-branched.
//
// Android: shows the UPI number inline with a Copy button.
// iOS:     shows a "View payment details" button that opens the hosted
//          payment.html page in the system Safari browser (Apple App Store
//          rules discourage rendering direct payment CTAs in-app).
//
// After paying externally, the user snaps a screenshot in their UPI app
// and uploads it here. The donation is created as pending and only
// counts once a super admin verifies it.
// -----------------------------------------------------------------------------

const QUICK_AMOUNTS = [100, 500, 1000, 2000];

const formatINR = (n) => {
  const v = Number.parseFloat(n);
  if (!Number.isFinite(v)) return '₹0';
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

export default function DonateScreen() {
  const router = useRouter();
  const [amount, setAmount]         = useState('');
  const [note, setNote]             = useState('');
  const [screenshot, setScreenshot] = useState(null);   // { uri, mimeType?, fileName? }
  const [submitting, setSubmitting] = useState(false);

  const [payment, setPayment]       = useState(null);   // { contact_number, payment_url }
  const [loadingPay, setLoadingPay] = useState(true);
  const [payError, setPayError]     = useState(null);
  const [copied, setCopied]         = useState(false);

  const fetchPayment = useCallback(async () => {
    setPayError(null);
    setLoadingPay(true);
    try {
      const res = await donationsApi.getPaymentInfo();
      if (res.success) setPayment(res.data);
    } catch (err) {
      setPayError("Couldn't load payment details right now.");
    } finally {
      setLoadingPay(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchPayment(); }, [fetchPayment]));

  const handleCopy = async () => {
    if (!payment?.contact_number) return;
    try {
      // UPI apps expect just the 10-digit local number. Strip formatting
      // and drop the +91 country code if present so pasting is clean.
      const digits = payment.contact_number.replace(/\D/g, '');
      const local = digits.startsWith('91') && digits.length === 12
        ? digits.slice(2)
        : digits;
      await Clipboard.setStringAsync(local);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      Alert.alert("Couldn't copy", 'Long-press the number to copy it manually.');
    }
  };

  const handleOpenPaymentPage = async () => {
    if (!payment?.payment_url) return;
    try {
      const supported = await Linking.canOpenURL(payment.payment_url);
      if (!supported) throw new Error('unsupported');
      await Linking.openURL(payment.payment_url);
    } catch {
      Alert.alert("Couldn't open the payment page", 'Try again or copy the number from your admin.');
    }
  };

  const handlePickScreenshot = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      return Alert.alert(
        'Photos permission needed',
        'To upload your payment screenshot, allow photo access in Settings.'
      );
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions?.Images || 'images',
      allowsEditing: false,
      quality: 0.9,
      exif: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      const a = result.assets[0];
      setScreenshot({
        uri:      a.uri,
        mimeType: a.mimeType || 'image/jpeg',
        fileName: a.fileName || `donation-${Date.now()}.jpg`,
        width:    a.width,
        height:   a.height,
      });
    }
  };

  const handleSubmit = async () => {
    const numeric = Number.parseFloat(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return Alert.alert('Check the amount', 'Enter an amount greater than zero.');
    }
    if (!screenshot) {
      return Alert.alert('Attach a screenshot', 'Upload a screenshot of your payment so a super admin can verify it.');
    }

    setSubmitting(true);
    try {
      await donationsApi.submit({
        amount:     numeric,
        note:       note.trim() || undefined,
        screenshot,
      });
      // Reset the form and show a clean success screen via Alert + navigate.
      setAmount('');
      setNote('');
      setScreenshot(null);
      Alert.alert(
        'Donation submitted',
        'Your donation is awaiting verification. You can watch its status in your donation history.',
        [
          { text: 'Back to home', style: 'cancel' },
          { text: 'View history', onPress: () => router.push('/donation-history') },
        ]
      );
    } catch (err) {
      Alert.alert(
        "Couldn't submit donation",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Donate"
        trailing={
          <Pressable
            onPress={() => router.push('/donation-history')}
            hitSlop={8}
            style={({ pressed }) => pressed && { opacity: 0.5 }}
            accessibilityRole="button"
            accessibilityLabel="View donation history"
          >
            <Text style={styles.headerLink}>History</Text>
          </Pressable>
        }
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Step 1 — Payment details, platform-branched */}
          <View style={styles.section}>
            <SectionHeader title="1. Pay with any UPI app" ornament="star" />
            {loadingPay ? (
              <Card><LoadingState message="Loading payment details…" compact /></Card>
            ) : payError ? (
              <Card><ErrorState message={payError} onRetry={fetchPayment} /></Card>
            ) : Platform.OS === 'ios' ? (
              /* iOS — link out to Safari */
              <Card tone="warm">
                <Text style={styles.paymentEyebrow}>Payment number</Text>
                <Text style={styles.paymentHeadline}>Open the payment page</Text>
                <Text style={styles.paymentBody}>
                  Tap below to see the UPI number in Safari. Send your donation, then
                  return here and upload the screenshot.
                </Text>
                <Button
                  label="View payment details"
                  onPress={handleOpenPaymentPage}
                  icon="open-outline"
                  iconRight
                  fullWidth
                  style={{ marginTop: space[3] }}
                />
              </Card>
            ) : (
              /* Android / anything else — inline number + copy */
              <Card tone="warm">
                <Text style={styles.paymentEyebrow}>Send your donation to</Text>
                <View style={styles.numberRow}>
                  <Text style={styles.numberText} selectable>
                    {payment?.contact_number || '+91 96327 16392'}
                  </Text>
                  <Pressable
                    onPress={handleCopy}
                    style={({ pressed }) => [styles.copyBtn, pressed && styles.copyBtnPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Copy payment number"
                  >
                    <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={colors.paper} />
                    <Text style={styles.copyBtnText}>{copied ? 'Copied' : 'Copy'}</Text>
                  </Pressable>
                </View>
                <Text style={styles.paymentHint}>
                  Open Google Pay, PhonePe, or Paytm and paste this number as the recipient.
                </Text>
              </Card>
            )}
          </View>

          {/* Step 2 — Amount */}
          <View style={styles.section}>
            <SectionHeader title="2. Enter the amount" />
            <Card>
              <Text style={styles.label}>Amount (₹)</Text>
              <Input
                value={amount}
                onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
                placeholder="0"
                keyboardType="decimal-pad"
                icon="cash-outline"
              />

              <View style={styles.quickRow}>
                {QUICK_AMOUNTS.map((v) => (
                  <Chip
                    key={v}
                    label={`₹${v}`}
                    tone={amount === String(v) ? 'teal' : 'neutral'}
                    selected={amount === String(v)}
                    onPress={() => setAmount(String(v))}
                  />
                ))}
              </View>

              <Text style={[styles.label, { marginTop: space[4] }]}>Note (optional)</Text>
              <Input
                value={note}
                onChangeText={setNote}
                placeholder="UPI reference, in memory of, etc."
                multiline
                maxLength={500}
              />
            </Card>
          </View>

          {/* Step 3 — Screenshot */}
          <View style={styles.section}>
            <SectionHeader title="3. Attach payment screenshot" />
            <Card>
              {screenshot ? (
                <View>
                  <Image
                    source={{ uri: screenshot.uri }}
                    style={styles.preview}
                    resizeMode="contain"
                    accessibilityLabel="Selected payment screenshot"
                  />
                  <View style={styles.previewActions}>
                    <Button
                      label="Change screenshot"
                      onPress={handlePickScreenshot}
                      variant="secondary"
                      size="sm"
                      icon="refresh-outline"
                    />
                    <Button
                      label="Remove"
                      onPress={() => setScreenshot(null)}
                      variant="ghost"
                      size="sm"
                      icon="trash-outline"
                    />
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={handlePickScreenshot}
                  style={({ pressed }) => [styles.picker, pressed && styles.pickerPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Choose a screenshot from your photos"
                >
                  <View style={styles.pickerIcon}>
                    <Ionicons name="cloud-upload-outline" size={26} color={colors.teal} />
                  </View>
                  <Text style={styles.pickerTitle}>Choose a screenshot</Text>
                  <Text style={styles.pickerHint}>PNG or JPG up to 5 MB</Text>
                </Pressable>
              )}
            </Card>
          </View>

          {/* Submit */}
          <View style={styles.section}>
            <Button
              label={submitting ? 'Submitting…' : `Submit donation${amount ? ` of ${formatINR(amount)}` : ''}`}
              onPress={handleSubmit}
              loading={submitting}
              disabled={!amount || !screenshot}
              fullWidth
              icon="checkmark-circle-outline"
            />
            <Text style={styles.footnote}>
              Your donation is created as <Text style={{ fontWeight: '700' }}>pending</Text> until
              a super admin verifies your screenshot.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { padding: space[4], paddingBottom: space[10] },

  headerLink: { ...type.body, color: colors.teal, fontWeight: '700' },

  section: { marginBottom: space[5] },

  label:   { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },

  quickRow: { flexDirection: 'row', gap: space[2], marginTop: space[3], flexWrap: 'wrap' },

  // Android payment number block
  paymentEyebrow: { ...type.micro, color: colors.gold, fontWeight: '700', marginBottom: space[1] },
  paymentHeadline:{ ...type.h2, marginBottom: space[2] },
  paymentBody:    { ...type.body },
  paymentHint:    { ...type.meta, marginTop: space[3] },

  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    backgroundColor: colors.paper,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    marginTop: space[2],
  },
  numberText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.tealDark,
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.teal,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: 8,
    minHeight: 36,
  },
  copyBtnPressed: { backgroundColor: colors.tealDark },
  copyBtnText: { color: colors.paper, fontWeight: '700', fontSize: 13 },

  // Screenshot picker
  picker: {
    alignItems: 'center',
    padding: space[6],
    borderWidth: 1,
    borderColor: colors.tealBorder,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
    backgroundColor: colors.tealSoft,
    gap: space[1],
  },
  pickerPressed: { backgroundColor: colors.paper },
  pickerIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.paper,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space[2],
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  pickerTitle: { ...type.bodyStrong },
  pickerHint:  { ...type.meta },

  preview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    backgroundColor: colors.ruleFaint,
  },
  previewActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space[3],
  },

  footnote: { ...type.meta, textAlign: 'center', marginTop: space[3] },
});
