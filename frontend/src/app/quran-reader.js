import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { quranApi } from '../api/quran';
import { colors, fonts, ARABIC_TEXT_STYLE, toArabicDigits } from '../components/islamicTheme';

// -----------------------------------------------------------------------------
// Quran reader — one surah, top-to-bottom, no pagination.
//
// Script — we prefer Indo-Pak orthography (text_indopak) because most
// South Asian readers are used to that muṣḥaf style. When a verse row
// only has the Uthmani variant (legacy rows synced before the schema
// added text_indopak), we fall back to text_uthmani so the reader
// never renders empty.
//
// Layout — Arabic block first, then a small breathing gap, then the
// English translation. Between verses, a visible gold rule with a
// centered ۞ so ayat boundaries are unmistakable without shouting.
// -----------------------------------------------------------------------------

const ORNATE_LEFT  = '﴾';
const ORNATE_RIGHT = '﴿';

export default function QuranReaderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const surahId = Number.parseInt(params.surah, 10);

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(surahId) || surahId < 1 || surahId > 114) {
      setError('That surah number is not between 1 and 114.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await quranApi.getSurah(surahId);
      if (res.success) setData(res.data);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        setError("This surah isn't loaded yet. Ask the coordinator to run the Quran sync.");
      } else {
        setError("Couldn't load this surah — check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [surahId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const chapter = data?.chapter;
  const verses  = data?.verses || [];

  const translationSource = useMemo(
    () => verses.find((v) => v.translation_source)?.translation_source,
    [verses]
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.teal} />
        <Text style={styles.loadingText}>
          {chapter?.name_simple ? `Loading Surah ${chapter.name_simple}…` : `Loading surah ${surahId}…`}
        </Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <ReaderHeader router={router} chapter={chapter} surahId={surahId} />
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.inkGhost} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ReaderHeader router={router} chapter={chapter} surahId={surahId} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator>
        {/* Surah title strip */}
        <View style={styles.titleBlock}>
          <Text style={styles.surahArabic} accessibilityLanguage="ar">
            {chapter?.name_arabic}
          </Text>
          <View style={styles.titleRule} />
          <Text style={styles.surahMeta}>
            {chapter?.translated_name ? `${chapter.translated_name} · ` : ''}
            {chapter?.revelation_place === 'medinan' ? 'Revealed in Madinah' : 'Revealed in Makkah'}
            {' · '}
            {chapter?.verses_count} verses
          </Text>
        </View>

        {/* Bismillah (skip surah 1 and 9) */}
        {chapter?.bismillah_pre && surahId !== 1 && (
          <View style={styles.bismillahBlock}>
            <View style={styles.ornamentRule} />
            <Text
              style={styles.bismillahText}
              accessibilityLabel="Bismillah ar-Rahman ar-Raheem"
            >
              بسم اللہ الرحمٰن الرحیم
            </Text>
            <View style={styles.ornamentRule} />
          </View>
        )}

        {/* Verses — each is: Arabic (Indo-Pak) → translation → visible gold rule */}
        {verses.map((v, idx) => {
          // Prefer Indo-Pak orthography; fall back to Uthmani if the
          // row hasn't been re-synced yet.
          const arabicText = v.text_indopak || v.text_uthmani;
          const isLast = idx === verses.length - 1;

          return (
            <View
              key={v.verse_key}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`Verse ${v.verse_number}. ${v.translation_text || ''}`}
            >
              <View style={styles.verseBlock}>
                {/* Arabic — the ﴿١﴾ verse marker sits inline at the end
                    of the Arabic line and flows with justification. */}
                <Text style={styles.arabicText} selectable accessibilityLanguage="ar">
                  {arabicText}
                  {'  '}
                  <Text style={styles.verseMarker}>
                    {ORNATE_LEFT}
                    {toArabicDigits(v.verse_number)}
                    {ORNATE_RIGHT}
                  </Text>
                </Text>

                {v.translation_text ? (
                  <Text style={styles.translation}>
                    <Text style={styles.verseNumberInline}>{v.verse_number}. </Text>
                    {v.translation_text}
                  </Text>
                ) : null}
              </View>

              {/* Visible gold divider between ayat — hairline · ۞ · hairline.
                  Uses the same ornament vocabulary as the home page and
                  bismillah, so it reads as structural rather than decorative. */}
              {!isLast && (
                <View style={styles.verseDivider}>
                  <View style={styles.dividerRule} />
                  <Text style={styles.dividerStar}>۞</Text>
                  <View style={styles.dividerRule} />
                </View>
              )}
            </View>
          );
        })}

        {translationSource ? (
          <Text style={styles.attribution}>Translation · {translationSource}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReaderHeader({ router, chapter, surahId }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={colors.inkMuted} />
      </TouchableOpacity>
      <View style={styles.headerCenter}>
        <Text style={styles.headerSurahName}>
          {chapter?.name_simple || `Surah ${surahId}`}
        </Text>
        {chapter?.translated_name ? (
          <Text style={styles.headerMeaning}>{chapter.translated_name}</Text>
        ) : null}
      </View>
      <Text style={styles.headerArabic} accessibilityLanguage="ar">
        {chapter?.name_arabic || ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paperSoft },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  backBtn:          { padding: 4 },
  headerCenter:     { flex: 1 },
  headerSurahName:  { fontSize: 17, fontWeight: '700', color: colors.ink },
  headerMeaning:    { fontSize: 12, color: colors.inkFaint, marginTop: 2 },
  headerArabic: {
    fontFamily: fonts.arabicBold,
    fontSize: 22,
    color: colors.teal,
  },

  scrollContent: { paddingHorizontal: 20, paddingVertical: 20, paddingBottom: 60 },

  // Surah title strip
  titleBlock:      { alignItems: 'center', marginBottom: 12 },
  surahArabic: {
    ...ARABIC_TEXT_STYLE,
    textAlign: 'center',
    fontFamily: fonts.arabicBold,
    fontSize: 30,
    color: colors.ink,
    marginBottom: 6,
  },
  titleRule: {
    height: 1, width: 60,
    backgroundColor: colors.gold, opacity: 0.6,
    marginBottom: 8,
  },
  surahMeta: { fontSize: 12, color: colors.inkFaint },

  // Bismillah
  bismillahBlock: { alignItems: 'center', marginVertical: 18, gap: 12 },
  ornamentRule:   { height: 1, width: '55%', backgroundColor: colors.goldBorder },
  bismillahText: {
    ...ARABIC_TEXT_STYLE,
    textAlign: 'center',
    fontFamily: fonts.arabicBold,
    fontSize: 28,
    lineHeight: 50,
    color: colors.ink,
  },

  // Verse
  verseBlock: {
    // Room to breathe between arabic ↔ translation ↔ divider.
    paddingVertical: 6,
  },
  arabicText: {
    ...ARABIC_TEXT_STYLE,
    fontSize: 26,
    lineHeight: 56,       // ~2.15× — muṣḥaf-style spacing
  },
  verseMarker: {
    fontFamily: fonts.arabic,
    fontSize: 22,
    color: colors.gold,
  },
  translation: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.inkMuted,
    marginTop: 12,
  },
  verseNumberInline: {
    fontWeight: '700',
    color: colors.teal,
  },

  // Visible divider between verses — gold hairline · ۞ · gold hairline.
  // Structural, matches the ornament vocabulary in the home + bismillah.
  verseDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 20,
  },
  dividerRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.goldBorder,
  },
  dividerStar: {
    fontSize: 14,
    color: colors.gold,
    lineHeight: 14,
  },

  attribution: {
    fontSize: 11,
    color: colors.inkGhost,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 8,
  },

  loadingText: { fontSize: 13, color: colors.inkFaint },
  errorText:   { fontSize: 14, color: colors.inkMuted, textAlign: 'center', lineHeight: 22 },
  retryBtn:    { backgroundColor: colors.teal, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 8 },
  retryText:   { color: colors.paper, fontWeight: '700', fontSize: 14 },
});
