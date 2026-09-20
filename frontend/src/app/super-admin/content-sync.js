import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { prayersApi } from '../../api/prayers';
import { quranApi } from '../../api/quran';
import { duaApi } from '../../api/dua';
import {
  Button,
  Card,
  Header,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Super admin — content sync triggers.
//
// Three fire-and-forget backend endpoints, previously invocable only via
// cURL/Postman:
//   POST /api/prayers/refresh   — re-fetch AlAdhan for a given date
//   POST /api/quran/sync        — re-pull 114 surahs + translations
//   POST /api/dua/sync          — re-seed dua library from bundled JSON
//
// Each server-side task can take tens of seconds; the backend returns
// 202 immediately (fire-and-forget). The UI reflects that honestly —
// "Sync started" — and warns to check server logs for progress.
// -----------------------------------------------------------------------------

export default function SuperAdminContentSyncScreen() {
  const router = useRouter();

  const [busy, setBusy] = useState({ prayers: false, quran: false, dua: false });

  const run = async (key, fn, name) => {
    Alert.alert(
      `Sync ${name} now?`,
      "This kicks off the sync on the server. It may take up to a minute. Existing data stays available while the sync runs.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync',
          onPress: async () => {
            setBusy((prev) => ({ ...prev, [key]: true }));
            try {
              const res = await fn();
              Alert.alert(
                `${name} sync started`,
                res?.message || 'The sync is running in the background. Check server logs for progress.',
              );
            } catch (err) {
              Alert.alert(
                `Couldn't start ${name} sync`,
                err?.response?.data?.message || 'Try again in a moment.',
              );
            } finally {
              setBusy((prev) => ({ ...prev, [key]: false }));
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Content sync" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.list}>
        <SectionHeader
          title="Refresh Islamic content"
          subtitle="Kick off a server-side sync when upstream data has changed."
          ornament="star"
        />

        <SyncRow
          icon="time-outline"
          title="Prayer timings"
          body="Force-fetch today's timings from AlAdhan, bypassing the DB cache. Useful after a DST edge case or if the cached timings look off."
          busy={busy.prayers}
          onPress={() => run('prayers', () => prayersApi.forceRefresh(), "Prayer timings")}
        />

        <SyncRow
          icon="book-outline"
          title="Qur'an"
          body="Re-pull all 114 surahs + Sahih International translations from api.quran.com. ~30–60 seconds server-side."
          busy={busy.quran}
          onPress={() => run('quran', () => quranApi.triggerSync(), "Qur'an")}
        />

        <SyncRow
          icon="library-outline"
          title="Duas"
          body="Re-seed the dua library from the bundled JSON on the server. Fast; runs in a couple of seconds."
          busy={busy.dua}
          onPress={() => run('dua', () => duaApi.triggerSync(), "Duas")}
        />

        <Card tone="warm">
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={18} color={colors.gold} />
            <View style={{ flex: 1 }}>
              <Text style={styles.noticeTitle}>Background jobs</Text>
              <Text style={styles.noticeBody}>
                The server returns immediately after starting each sync — the actual
                work happens in the background. Progress lives in server logs, not here.
              </Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function SyncRow({ icon, title, body, busy, onPress }) {
  return (
    <View style={{ marginBottom: space[3] }}>
      <Card>
        <View style={styles.row}>
          <View style={styles.iconWrap}>
            <Ionicons name={icon} size={20} color={colors.tealDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            label={busy ? 'Starting…' : 'Sync now'}
            onPress={onPress}
            loading={busy}
            disabled={busy}
            icon="sync-outline"
            size="sm"
            style={{ alignSelf: 'flex-start' }}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  list:   { padding: space[4], paddingBottom: space[8] },

  row:      { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  iconWrap: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  title:  { ...type.h3 },
  body:   { ...type.body, marginTop: space[1] },
  actions:{ marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: colors.ruleFaint },

  noticeRow:   { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  noticeTitle: { ...type.bodyStrong },
  noticeBody:  { ...type.meta, marginTop: 2 },
});
