import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { quranApi } from '../../api/quran';
import { colors, fonts } from '../../components/islamicTheme';

// -----------------------------------------------------------------------------
// Quran chapter list.
//
// One-shot load from our own DB (GET /api/quran/chapters). Search filters
// by surah number, Arabic name, English name, or English meaning. No
// pagination — 114 rows is well within a FlatList's comfort zone.
// -----------------------------------------------------------------------------
export default function QuranChapterList() {
  const router = useRouter();

  const [chapters,   setChapters]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [query,      setQuery]      = useState('');

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await quranApi.getChapters();
      if (res.success) setChapters(res.data.chapters || []);
    } catch (err) {
      setError("Couldn't load the chapter list — check your connection and pull to refresh.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter((c) => {
      return (
        String(c.id).includes(q) ||
        c.name_simple?.toLowerCase().includes(q) ||
        c.name_arabic?.includes(q) ||
        c.translated_name?.toLowerCase().includes(q)
      );
    });
  }, [chapters, query]);

  const renderChapter = ({ item }) => {
    const revealedIn =
      item.revelation_place === 'medinan' ? 'Madinah' : 'Makkah';

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() =>
          router.push({ pathname: '/quran-reader', params: { surah: item.id } })
        }
        accessibilityRole="button"
        accessibilityLabel={`Surah ${item.id}, ${item.name_simple}, ${item.verses_count} verses, revealed in ${revealedIn}`}
      >
        {/* Number medallion — subtle gold ring, plain teal numeral */}
        <View style={styles.numberMedallion}>
          <Text style={styles.numberText}>{item.id}</Text>
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.nameEnglish}>{item.name_simple}</Text>
          {item.translated_name ? (
            <Text style={styles.meaning}>{item.translated_name}</Text>
          ) : null}
          <Text style={styles.meta}>
            {item.verses_count} verses · Revealed in {revealedIn}
          </Text>
        </View>

        <Text style={styles.nameArabic} accessibilityLanguage="ar">
          {item.name_arabic}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Al-Qur&apos;an</Text>
        <Text style={styles.headerSubtitle}>114 surahs · Sahih International</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color={colors.inkGhost} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by number, Arabic or English name"
          placeholderTextColor={colors.inkGhost}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={16} color="#CBD5E1" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.teal} />
          <Text style={styles.loadingText}>Loading chapters…</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.inkGhost} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderChapter}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.teal]}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="search-outline" size={36} color={colors.inkGhost} />
              <Text style={styles.emptyText}>
                {query
                  ? 'No chapters match your search.'
                  : "This library is empty. Ask the coordinator to run the Quran sync."}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paperSoft },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle:    { fontSize: 22, fontWeight: '800', color: colors.ink },
  headerSubtitle: { fontSize: 12, color: colors.inkFaint, marginTop: 2 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.paper,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 2 },

  listContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 24 },
  separator:   { height: 1, backgroundColor: colors.ruleFaint, marginLeft: 60 },

  // Row: deliberately flat (no card shadow) so the list reads like an
  // index rather than a stack of hero cards.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 12,
  },
  numberMedallion: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    // Subtle gold ring — echoes the traditional muṣḥaf sura-marker
    // roundel without shouting.
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  numberText: { fontSize: 13, fontWeight: '700', color: colors.tealDark },

  rowBody:     { flex: 1 },
  nameEnglish: { fontSize: 15, fontWeight: '700', color: colors.ink },
  meaning:     { fontSize: 12, color: colors.inkFaint, fontStyle: 'italic', marginTop: 1 },
  meta:        { fontSize: 11, color: colors.inkGhost, marginTop: 4 },

  nameArabic: {
    fontFamily: fonts.arabicBold,
    fontSize: 22,
    color: colors.ink,
    // Small nudge so the Arabic name sits vertically centered on the row.
    marginLeft: 4,
  },

  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  loadingText: { fontSize: 13, color: colors.inkFaint },
  errorText:   { fontSize: 14, color: colors.inkMuted, textAlign: 'center', lineHeight: 22 },
  emptyText:   { fontSize: 14, color: colors.inkFaint, textAlign: 'center', lineHeight: 22 },
  retryBtn:    { marginTop: 4, backgroundColor: colors.teal, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 8 },
  retryText:   { color: colors.paper, fontWeight: '700', fontSize: 14 },
});
