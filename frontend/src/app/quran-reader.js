import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  I18nManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { quranApi } from '../api/quran';

// -----------------------------------------------------------------------------
// Quran reader — one surah, top-to-bottom, no pagination.
//
// Layout notes:
//   • Arabic text uses writingDirection:'rtl' and textAlign:'right' so
//     characters render right-to-left even when the app's I18nManager is
//     configured for LTR (the common case for a bilingual app).
//   • Generous line-height (2.2×) matches muṣḥaf-style spacing.
//   • Verse numbers rendered inside a circular badge — structural, not
//     decorative — with an accessibilityLabel so screen readers announce
//     "Verse 5" instead of reading it as a stray number.
// -----------------------------------------------------------------------------

// Arabic-Indic numerals for verse markers (U+0660..U+0669).
const arabicNumeral = (n) =>
  String(n)
    .split('')
    .map((d) => String.fromCharCode(0x0660 + Number(d)))
    .join('');

export default function QuranReaderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const surahId = Number.parseInt(params.surah, 10);

  const [data,    setData]    = useState(null); // { chapter, verses }
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(surahId) || surahId < 1 || surahId > 114) {
      setError('Invalid surah number');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await quranApi.getSurah(surahId);
      if (res.success) setData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load surah');
    } finally {
      setLoading(false);
    }
  }, [surahId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const chapter = data?.chapter;
  const verses  = data?.verses || [];

  // Translation attribution — take from the first verse that has one.
  const translationSource = useMemo(
    () => verses.find((v) => v.translation_source)?.translation_source,
    [verses]
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#0D9488" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <Ionicons name="alert-circle-outline" size={40} color="#DC2626" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={load}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#1F2937" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{chapter?.name_simple || `Surah ${surahId}`}</Text>
          {chapter?.translated_name ? (
            <Text style={styles.headerSubtitle}>{chapter.translated_name}</Text>
          ) : null}
        </View>
        <Text style={styles.headerArabic}>{chapter?.name_arabic || ''}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {/* Bismillah — shown for every surah except surah 9 (At-Tawbah) */}
        {chapter?.bismillah_pre && surahId !== 1 && (
          <View style={styles.bismillahBox}>
            <Text
              style={styles.bismillahText}
              accessibilityLabel="Bismillah ar-Rahman ar-Raheem"
            >
              بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
            </Text>
          </View>
        )}

        {/* Verses */}
        {verses.map((v) => (
          <View
            key={v.verse_key}
            style={styles.verseBlock}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Verse ${v.verse_number}. ${v.translation_text || ''}`}
          >
            {/* Arabic + verse marker row. The badge sits at the end of
                the Arabic line because RTL text ends at the left edge. */}
            <View style={styles.arabicRow}>
              <Text
                style={styles.arabicText}
                selectable
                accessibilityLanguage="ar"
              >
                {v.text_uthmani}
              </Text>
              <View
                style={styles.verseBadge}
                accessibilityRole="text"
                accessibilityLabel={`Verse ${v.verse_number}`}
              >
                <Text style={styles.verseBadgeText}>{arabicNumeral(v.verse_number)}</Text>
              </View>
            </View>

            {v.translation_text ? (
              <Text style={styles.translation}>{v.translation_text}</Text>
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
// Styles
// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  centered:  { justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  backBtn:        { padding: 4 },
  headerCenter:   { flex: 1 },
  headerTitle:    { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  headerSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  headerArabic:   { fontSize: 20, fontWeight: '700', color: '#0D9488' },

  scrollContent:  { paddingHorizontal: 18, paddingVertical: 18, paddingBottom: 60 },

  bismillahBox: {
    paddingVertical: 18,
    marginBottom: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  bismillahText: {
    fontSize: 26,
    color: '#0F172A',
    // Explicit RTL — don't rely on I18nManager which may be LTR-locked.
    writingDirection: 'rtl',
    textAlign: 'center',
    lineHeight: 46,
  },

  verseBlock: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },

  arabicRow: {
    // Flex direction 'row-reverse' so the verse-marker badge sits at the
    // left (which is the *end* of the Arabic line) without depending on
    // I18nManager state.
    flexDirection: I18nManager.isRTL ? 'row' : 'row-reverse',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 12,
  },
  arabicText: {
    flex: 1,
    fontSize: 24,
    lineHeight: 52,           // ~2.2× — generous, muṣḥaf-style spacing
    color: '#0F172A',
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  verseBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0FDF9',
    borderWidth: 1,
    borderColor: '#0D9488',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  verseBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0D9488',
  },

  translation: {
    fontSize: 15,
    lineHeight: 24,
    color: '#334155',
  },

  attribution: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 8,
  },

  errorText: { fontSize: 13, color: '#DC2626', textAlign: 'center' },
  retryBtn:  { backgroundColor: '#0D9488', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
});
