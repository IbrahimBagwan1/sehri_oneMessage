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

// -----------------------------------------------------------------------------
// Quran chapter list.
//
// One-shot load from our own DB (GET /api/quran/chapters) — no upstream
// calls, no pagination (only 114 rows). Search filters by surah number,
// Arabic name, English name, or English meaning.
// -----------------------------------------------------------------------------
const REVELATION_LABEL = {
  meccan:  'Meccan',
  medinan: 'Medinan',
};

const revelationStyle = (place) =>
  place === 'medinan'
    ? { color: '#0369A1', bg: '#E0F2FE' }
    : { color: '#0D9488', bg: '#F0FDF9' };

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
      setError(err.response?.data?.message || 'Could not load Quran chapters');
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
    const rev = revelationStyle(item.revelation_place);
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() =>
          router.push({ pathname: '/quran-reader', params: { surah: item.id } })
        }
        accessibilityRole="button"
        accessibilityLabel={`${item.name_simple}, surah ${item.id}, ${item.verses_count} verses`}
      >
        <View style={styles.numberBox}>
          <Text style={styles.numberText}>{item.id}</Text>
        </View>

        <View style={styles.cardBody}>
          <View style={styles.titleRow}>
            <Text style={styles.nameEnglish}>{item.name_simple}</Text>
            <Text style={styles.nameArabic}>{item.name_arabic}</Text>
          </View>

          <View style={styles.metaRow}>
            {item.translated_name ? (
              <Text style={styles.meaning}>{item.translated_name}</Text>
            ) : null}
          </View>

          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: rev.bg }]}>
              <Ionicons
                name={item.revelation_place === 'medinan' ? 'business-outline' : 'sunny-outline'}
                size={11}
                color={rev.color}
              />
              <Text style={[styles.badgeText, { color: rev.color }]}>
                {REVELATION_LABEL[item.revelation_place] || item.revelation_place}
              </Text>
            </View>
            <View style={styles.badgeNeutral}>
              <Ionicons name="reader-outline" size={11} color="#64748B" />
              <Text style={styles.badgeTextNeutral}>{item.verses_count} verses</Text>
            </View>
          </View>
        </View>

        <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Al-Qur&apos;an</Text>
        <Text style={styles.headerSubtitle}>114 surahs · Sahih International</Text>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by number, Arabic or English name"
          placeholderTextColor="#94A3B8"
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
          <ActivityIndicator size="large" color="#0D9488" />
          <Text style={styles.loadingText}>Loading chapters…</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color="#DC2626" />
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={['#0D9488']}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="book-outline" size={40} color="#CBD5E1" />
              <Text style={styles.emptyText}>
                {query
                  ? 'No chapters match your search.'
                  : 'No chapters yet — the Quran sync may still be running.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle:    { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  headerSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 2 },

  listContent: { padding: 14, paddingTop: 8 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  numberBox: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F0FDF9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  numberText:   { fontSize: 15, fontWeight: '800', color: '#0D9488' },
  cardBody:     { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  nameEnglish:  { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  nameArabic:   { fontSize: 18, color: '#0D9488', fontWeight: '700', textAlign: 'right' },
  metaRow:      { marginBottom: 6 },
  meaning:      { fontSize: 12, color: '#64748B', fontStyle: 'italic' },
  badgeRow:     { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText:    { fontSize: 10, fontWeight: '700' },
  badgeNeutral: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  badgeTextNeutral: { fontSize: 10, fontWeight: '700', color: '#64748B' },

  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  loadingText: { fontSize: 13, color: '#64748B' },
  errorText:   { fontSize: 13, color: '#DC2626', textAlign: 'center' },
  emptyText:   { fontSize: 13, color: '#94A3B8', textAlign: 'center' },
  retryBtn:    { marginTop: 8, backgroundColor: '#0D9488', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText:   { color: '#FFF', fontWeight: '700', fontSize: 14 },
});
