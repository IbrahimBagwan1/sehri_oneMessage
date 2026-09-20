import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { broadcastsApi } from '../../api/broadcasts';
import { locationsApi } from '../../api/auth';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Super-admin — send a push broadcast to every user in a zone (or all).
//
// Compose card at the top: title (optional) + message + zone chip picker.
// The chip labelled "All zones" is the default. Tapping any zone chip
// scopes the push to users whose location is inside that zone.
//
// History list below, newest first — shows each past broadcast with the
// target zone, delivered/recipient ratio, and time.
// -----------------------------------------------------------------------------

export default function SuperAdminBroadcastScreen() {
  const router = useRouter();

  // Compose state
  const [title,   setTitle]   = useState('');
  const [message, setMessage] = useState('');
  const [zoneId,  setZoneId]  = useState(null);   // null = all zones
  const [sending, setSending] = useState(false);

  // Zone picker
  const [zones, setZones]           = useState([]);
  const [zonesLoading, setZonesLoading] = useState(true);

  // History
  const [history, setHistory]           = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError,   setHistoryError]   = useState(null);

  // --- Loaders ------------------------------------------------------------
  const loadZones = useCallback(async () => {
    setZonesLoading(true);
    try {
      // Zone-level rows (Bangalore has zone as the addressable level).
      const res = await locationsApi.getLocations({ type: 'zone' });
      setZones(res.data || []);
    } catch (err) {
      // Non-fatal — the "All zones" default still works.
      setZones([]);
    } finally {
      setZonesLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await broadcastsApi.list({ limit: 50 });
      setHistory(res?.data?.broadcasts || []);
    } catch (err) {
      setHistoryError(err?.response?.data?.message || "Couldn't load broadcast history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadZones(); }, [loadZones]);
  useFocusEffect(useCallback(() => { loadHistory(); }, [loadHistory]));

  // --- Send ---------------------------------------------------------------
  const targetLabel = useMemo(() => {
    if (!zoneId) return 'All approved users';
    const z = zones.find((x) => x.id === zoneId);
    return z ? `Users in ${z.name}` : 'Selected zone';
  }, [zoneId, zones]);

  const handleSend = () => {
    const body = message.trim();
    if (!body) {
      Alert.alert('Message', 'Please write the message you want to send.');
      return;
    }
    if (body.length > 2000) {
      Alert.alert('Message', 'That message is too long (max 2000 characters).');
      return;
    }

    Alert.alert(
      'Send broadcast?',
      `${targetLabel} will get a push notification. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          style: 'default',
          onPress: async () => {
            setSending(true);
            try {
              const res = await broadcastsApi.send({
                title: title.trim() || undefined,
                message: body,
                target_location_id: zoneId,
              });
              if (res.success) {
                Alert.alert(
                  'Broadcast sent',
                  res.message || 'Push delivered.',
                );
                setTitle('');
                setMessage('');
                setZoneId(null);
                loadHistory();
              }
            } catch (err) {
              Alert.alert("Couldn't send", err?.response?.data?.message || 'Try again in a moment.');
            } finally {
              setSending(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Send broadcast" onBack={() => router.back()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Compose card */}
          <View style={styles.composeCard}>
            <View style={styles.composeHead}>
              <View style={styles.composeIcon}>
                <Ionicons name="megaphone-outline" size={18} color={colors.tealDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.composeTitle}>New broadcast</Text>
                <Text style={styles.composeHint} numberOfLines={1}>
                  Sends an instant push. Choose the audience carefully.
                </Text>
              </View>
            </View>

            <Text style={styles.fieldLabel}>Title <Text style={styles.optional}>· optional</Text></Text>
            <Input
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Ramadan schedule change"
              maxLength={120}
              autoCapitalize="sentences"
            />

            <View style={{ height: space[3] }} />
            <Text style={styles.fieldLabel}>Message</Text>
            <Input
              value={message}
              onChangeText={setMessage}
              placeholder="What do you want everyone to know?"
              multiline
              maxLength={2000}
              autoCapitalize="sentences"
            />
            <Text style={styles.counter}>{message.length} / 2000</Text>

            <View style={{ height: space[4] }} />
            <Text style={styles.fieldLabel}>Audience</Text>
            {zonesLoading ? (
              <Text style={styles.zonesLoading}>Loading zones…</Text>
            ) : (
              <View style={styles.chipsRow}>
                <Chip
                  label="All zones"
                  tone={zoneId === null ? 'teal' : 'neutral'}
                  icon="people-outline"
                  onPress={() => setZoneId(null)}
                  selected={zoneId === null}
                />
                {zones.map((z) => (
                  <Chip
                    key={z.id}
                    label={z.name}
                    tone={zoneId === z.id ? 'teal' : 'neutral'}
                    icon="location-outline"
                    onPress={() => setZoneId(z.id)}
                    selected={zoneId === z.id}
                  />
                ))}
              </View>
            )}
            <Text style={styles.audienceSummary}>{targetLabel}</Text>

            <View style={{ height: space[4] }} />
            <Button
              label={sending ? 'Sending…' : 'Send broadcast'}
              icon="paper-plane-outline"
              onPress={handleSend}
              loading={sending}
              disabled={!message.trim() || sending}
              fullWidth
            />
          </View>

          {/* History */}
          <SectionHeader title="Recent broadcasts" />
          {historyLoading ? (
            <LoadingState message="Loading history…" />
          ) : historyError ? (
            <ErrorState message={historyError} onRetry={loadHistory} />
          ) : history.length === 0 ? (
            <EmptyState
              icon="megaphone-outline"
              title="No broadcasts yet"
              message="Your sent broadcasts will appear here as an audit trail."
            />
          ) : (
            <View style={styles.historyList}>
              {history.map((row, i) => (
                <React.Fragment key={row.id}>
                  {i > 0 && <View style={styles.historyRule} />}
                  <HistoryRow row={row} />
                </React.Fragment>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HistoryRow({ row }) {
  const target = row.target_location?.name || 'All zones';
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyIcon}>
        <Ionicons name="megaphone" size={16} color={colors.tealDark} />
      </View>
      <View style={{ flex: 1 }}>
        {row.title ? <Text style={styles.historyTitle} numberOfLines={1}>{row.title}</Text> : null}
        <Text style={styles.historyMessage} numberOfLines={3}>{row.message}</Text>
        <View style={styles.historyMeta}>
          <Chip label={target} tone={row.target_location ? 'teal' : 'neutral'} icon="location-outline" />
          <Text style={styles.historyStat}>
            {row.delivered_count} / {row.recipient_count} delivered
          </Text>
          <Text style={styles.historyTime}>{formatWhen(row.created_at)}</Text>
        </View>
      </View>
    </View>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { paddingBottom: space[8] },

  // Compose ---------------------------------------------------------------
  composeCard: {
    margin: space[4],
    padding: space[4],
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
  },
  composeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginBottom: space[4],
  },
  composeIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  composeTitle: { ...type.h3 },
  composeHint:  { ...type.meta, marginTop: 2 },

  fieldLabel: { ...type.metaStrong, marginBottom: 6 },
  optional:   { color: colors.inkFaint, fontWeight: '500' },
  counter:    { ...type.micro, color: colors.inkGhost, marginTop: 6, alignSelf: 'flex-end' },

  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: 4,
  },
  audienceSummary: {
    ...type.meta,
    color: colors.tealDark,
    marginTop: space[2],
    fontWeight: '600',
  },
  zonesLoading: { ...type.meta, color: colors.inkFaint, paddingVertical: space[2] },

  // History ---------------------------------------------------------------
  historyList: {
    marginHorizontal: space[4],
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    overflow: 'hidden',
  },
  historyRule: { height: 1, backgroundColor: colors.ruleFaint, marginLeft: space[4] + 32 + space[3] },
  historyRow: {
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    alignItems: 'flex-start',
  },
  historyIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.tealSoft,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  historyTitle:   { ...type.bodyStrong },
  historyMessage: { ...type.body, marginTop: 2 },
  historyMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[2],
  },
  historyStat: { ...type.micro, color: colors.inkFaint },
  historyTime: { ...type.micro, color: colors.inkGhost, marginLeft: 'auto' },
});
