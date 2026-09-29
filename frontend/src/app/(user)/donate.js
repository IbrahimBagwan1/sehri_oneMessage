import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { donationsApi } from '../../api/donations';
import {
  Button,
  Card,
  Chip,
  GuestGate,
  Header,
  Input,
  SectionHeader,
  KeyboardAwareScroll
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';
import { useAuthStore } from '../../store/useAuthStore';
import { describeError } from '../../api/errors';
import { LEGAL_URLS, openLegalUrl } from '../../constants/legal';

// -----------------------------------------------------------------------------
// DonateScreen — external UPI donation flow.
//
// On both platforms "View payment details" opens the OneMessage website's
// home page (LEGAL_URLS.payment), which carries the UPI ID and QR code, in
// the system browser (Safari / the default Android browser). The app itself
// never shows the payment number or starts a payment: Apple
// 3.2.2(iv) requires charity funds to be collected outside the app, and
// Google Play only exempts tax-exempt donations from its billing rule, so
// keeping the payment step on the web satisfies both.
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

// Guest wrapper — see comment in track.js. Keeps rules-of-hooks clean.
export default function DonateScreen() {
  const isGuest = useAuthStore((s) => s.isGuest);
  if (isGuest) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Donate" />
        <GuestGate
          icon="heart-outline"
          title="Donations are for members"
          message="Sign in so we can verify your donation, credit it correctly, and show it in your history."
        />
      </SafeAreaView>
    );
  }
  return <DonateScreenAuthed />;
}

function DonateScreenAuthed() {
  const router = useRouter();
  const [amount, setAmount]         = useState('');
  const [note, setNote]             = useState('');
  const [screenshot, setScreenshot] = useState(null);   // { uri, mimeType?, fileName? }
  const [submitting, setSubmitting] = useState(false);

  // A fixed web page, so there is nothing to load before the button works;
  // with no signal the browser shows its own offline page.
  const handleOpenPaymentPage = () => openLegalUrl(LEGAL_URLS.payment, 'the payment details');

  // No permission request: the system picker (PHPicker on iOS, the Photo
  // Picker on Android) runs outside the app and returns only the image the
  // member chooses, so the app never needs access to the whole library —
  // and never shows a "allow access to all your photos" prompt.
  const handlePickScreenshot = async () => {
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
        describeError(err, 'Try again in a moment.')
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

      <KeyboardAwareScroll contentContainerStyle={styles.scroll}>
          {/* Step 1 — Payment details, on the website */}
          <View style={styles.section}>
            <SectionHeader title="1. Pay with any UPI app" ornament="star" />
            <Card tone="warm">
              <Text style={styles.paymentEyebrow}>Payment details</Text>
              <Text style={styles.paymentHeadline}>Open the payment page</Text>
              <Text style={styles.paymentBody}>
                Tap below to see where to send your donation. It opens in your
                browser; pay with any UPI app, then come back here and upload the
                screenshot.
              </Text>
              <Button
                label="View payment details"
                onPress={handleOpenPaymentPage}
                icon="open-outline"
                iconRight
                fullWidth
                accessibilityLabel="View payment details. Opens in your browser"
                style={{ marginTop: space[3] }}
              />
            </Card>
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
      </KeyboardAwareScroll>
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

  // Payment details card
  paymentEyebrow: { ...type.micro, color: colors.gold, fontWeight: '700', marginBottom: space[1] },
  paymentHeadline:{ ...type.h2, marginBottom: space[2] },
  paymentBody:    { ...type.body },

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
