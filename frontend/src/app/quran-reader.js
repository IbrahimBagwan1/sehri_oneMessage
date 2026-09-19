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
// Layout notes:
//   • Arabic uses the shared ARABIC_TEXT_STYLE which pins fontFamily
//     (Amiri), textAlign:'right', writingDirection:'rtl' — the three
//     properties that must always travel together to render Uthmani
//     script correctly, independent of the app's I18nManager state.
//   • Verse markers use the traditional ornate parentheses ﴿ ﴾ around
//     an Arabic-Indic numeral, in warm gold. This is how muṣḥaf pages
//     mark verse boundaries and it reads as structural (not decorative).
//   • Line-height 2.15× the Arabic font size, matching muṣḥaf spacing.
// -----------------------------------------------------------------------------

// Unicode ornate parentheses used to bracket verse numbers in
// traditional muṣḥaf typesetting.
const ORNATE_LEFT  = '﴾'; // ﴾ (visually left in LTR, right in Arabic)
const ORNATE_RIGHT = '﴿'; // ﴿

export default function QuranReaderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const surahId = Number.parseInt(params.surah, 10);

  const [data,    setData]    = useState(null); // { chapter, verses }
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

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {/* Surah title strip — Arabic name centered, meta below */}
        <View style={styles.titleBlock}>
          <Text style={styles.surahArabic} accessibilityLanguage="ar">
            {chapter?.name_arabic}
          </Text>
          <View style={styles.titleRule} />
          <Text style={styles.surahMeta}>
            {chapter?.translated_name
              ? `${chapter.translated_name} · `
              : ''}
            {chapter?.revelation_place === 'medinan' ? 'Revealed in Madinah' : 'Revealed in Makkah'}
            {' · '}
            {chapter?.verses_count} verses
          </Text>
        </View>

        {/* Bismillah — hidden for surah 9 (At-Tawbah) and surah 1
            (Al-Fatihah, where it is verse 1 itself). */}
        {chapter?.bismillah_pre && surahId !== 1 && (
          <View style={styles.bismillahBlock}>
            <View style={styles.ornamentRule} />
            <Text
              style={styles.bismillahText}
              accessibilityLabel="Bismillah ar-Rahman ar-Raheem"
            >
              بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
            </Text>
            <View style={styles.ornamentRule} />
          </View>
        )}

        {/* Verses */}
        {verses.map((v, idx) => (
          <View
            key={v.verse_key}
            style={[styles.verseBlock, idx === verses.length - 1 && styles.verseBlockLast]}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Verse ${v.verse_number}. ${v.translation_text || ''}`}
          >
            {/* Arabic — verse marker sits inline at the end of the line
                (which visually is the left edge in RTL). We render it as
                a suffix inside the same Text so the marker flows with
                justification instead of dangling in a side badge. */}
            <Text style={styles.arabicText} selectable accessibilityLanguage="ar">
              {v.text_uthmani}
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
        ))}

        {translationSource ? (
          <Text style={styles.attribution}>Translation · {translationSource}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// Header — extracted so loading + error states share it.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------
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

  // Title strip beneath the header
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
    height: 1,
    width: 60,
    backgroundColor: colors.gold,
    opacity: 0.6,
    marginBottom: 8,
  },
  surahMeta: {
    fontSize: 12,
    color: colors.inkFaint,
  },

  // Bismillah — set apart with hairline gold rules top and bottom
  bismillahBlock: {
    alignItems: 'center',
    marginVertical: 18,
    gap: 12,
  },
  ornamentRule: {
    height: 1,
    width: '55%',
    backgroundColor: colors.goldBorder,
  },
  bismillahText: {
    ...ARABIC_TEXT_STYLE,
    textAlign: 'center',
    fontFamily: fonts.arabicBold,
    fontSize: 28,
    lineHeight: 50,
    color: colors.ink,
  },

  // Individual verse block
  verseBlock: {
    marginBottom: 22,
    paddingBottom: 18,
    // Whisper-thin divider between verses — visible but not intrusive.
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleFaint,
  },
  verseBlockLast: {
    borderBottomWidth: 0,
  },

  arabicText: {
    ...ARABIC_TEXT_STYLE,
    fontSize: 26,
    lineHeight: 56, // ~2.15× — muṣḥaf-style spacing
  },
  verseMarker: {
    // Ornate parens + Arabic numeral; sits inline at end of the Arabic
    // line so it flows with justification rather than dangling to the side.
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
    // Small structural cue inside the English translation so a reader
    // scanning translations only can still map to verse boundaries.
    fontWeight: '700',
    color: colors.teal,
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
