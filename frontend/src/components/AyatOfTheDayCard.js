import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, ErrorState, LoadingState, RubStar } from './ui';
import { colors, space, type } from '../theme';
import { fonts } from './islamicTheme';

/**
 * AyatOfTheDayCard — the day's verse, between the namaz card and the poll.
 *
 * SOURCE: islamic.app picks it, not us. It is deterministic per UTC date and
 * identical for every caller worldwide; our backend caches it so at most one
 * upstream call happens per day. This is unrelated to the Qur'an corpus the
 * reader screens serve from quran_chapters / quran_verses. (No themed
 * `topic_ayat` pool exists in this app.)
 *
 * DESIGN: it sits between two cards that both ask something of the reader —
 * the namaz countdown is urgent, the poll wants a tap — so this one
 * deliberately asks for nothing. No buttons, no chevron, nothing to act on.
 * Gold Amiri on the app's warm parchment tone, the same ornament rule used
 * on the Hero and in the namaz sheet, and a translation set quietly beneath.
 * It should read as a pause between two demands, which is also why it is not
 * tappable: there is nowhere more to go.
 *
 * The three parts are kept visually distinct, per the established pattern on
 * the dua detail screen: Arabic, then a hairline gold rule, then the meaning,
 * then the citation smaller again.
 */
export default function AyatOfTheDayCard({ data, loading, error, onRetry }) {
  if (loading) {
    return (
      <Card tone="warm">
        <LoadingState message="Loading today's ayat…" compact />
      </Card>
    );
  }

  if (error) {
    return (
      <Card tone="warm">
        <ErrorState message={error} onRetry={onRetry} />
      </Card>
    );
  }

  // Nothing to show and nothing wrong — stay out of the way rather than
  // rendering an empty card between two full ones.
  if (!data?.arabic && !data?.translation) return null;

  const reference = data.surah_name
    ? `${data.surah_name} · ${data.surah_number}:${data.ayah_number}`
    : data.reference;

  return (
    <Card tone="warm">
      {/* Eyebrow — the same ۞ ornament rule used by the Hero and the
          namaz sheet, so the card announces itself the way the rest of
          the app does. */}
      <View style={styles.head}>
        <View style={styles.rule} />
        <RubStar size={11} />
        <View style={styles.rule} />
      </View>
      <Text style={styles.eyebrow}>Ayat of the day</Text>

      {data.arabic ? (
        <Text style={styles.arabic} accessibilityLanguage="ar" selectable>
          {data.arabic}
        </Text>
      ) : null}

      {data.arabic && data.translation ? <View style={styles.divider} /> : null}

      {data.translation ? (
        <Text style={styles.translation} selectable>{data.translation}</Text>
      ) : null}

      <View style={styles.footer}>
        {reference ? <Text style={styles.reference}>{reference}</Text> : <View />}
        {data.translator ? (
          <Text style={styles.translator}>{data.translator}</Text>
        ) : null}
      </View>

      {/* Understated, and worded as a fact rather than a warning — the verse
          is still a real verse, just yesterday's. Mirrors how the namaz
          sheet explains a locally-calculated fallback. */}
      {data.stale ? (
        <View style={styles.staleRow}>
          <Ionicons name="time-outline" size={12} color={colors.inkFaint} />
          <Text style={styles.staleText}>
            Today&apos;s verse hasn&apos;t arrived yet — showing the last one we received.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    alignSelf: 'center',
    width: 150,
  },
  rule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },
  eyebrow: {
    ...type.micro,
    color: colors.gold,
    textAlign: 'center',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: space[1],
    marginBottom: space[3],
  },

  // Gold Amiri with generous leading, matching the dua detail screen. RTL is
  // pinned explicitly rather than inherited: the rest of the UI stays LTR,
  // and the script has to render correctly regardless of I18nManager state.
  arabic: {
    fontFamily: fonts.arabic,
    fontSize: 21,
    lineHeight: 44,
    color: colors.ink,
    textAlign: 'right',
    writingDirection: 'rtl',
  },

  // The hairline gold rule the dua screen uses between Arabic and meaning.
  divider: {
    height: 1,
    backgroundColor: colors.goldBorder,
    opacity: 0.5,
    marginVertical: space[3],
  },

  translation: { ...type.body, color: colors.ink, lineHeight: 23 },

  footer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space[2],
    marginTop: space[3],
  },
  reference:  { ...type.metaStrong, color: colors.tealDark },
  translator: { ...type.micro, color: colors.inkFaint, fontStyle: 'italic' },

  staleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  staleText: { ...type.micro, color: colors.inkFaint, flex: 1, lineHeight: 15 },
});
