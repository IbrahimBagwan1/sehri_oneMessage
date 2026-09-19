import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { duaApi } from '../../api/dua';
import { colors, fonts, ARABIC_TEXT_STYLE } from '../../components/islamicTheme';

// -----------------------------------------------------------------------------
// Dua landing screen — categories list with the featured-of-the-day card
// at the top.
//
// Categories are rendered as a flat two-column grid (a subtle index look
// rather than uniform cards on a scroll of shadowed rectangles). The
// featured card at the top gets a warm parchment tint so it reads as
// separate content, not just "the first category".
// -----------------------------------------------------------------------------

// Icons per known category slug — falls back to a book glyph.
const CATEGORY_ICON = {
  morning:        'sunny-outline',
  evening:        'moon-outline',
  'after-prayer': 'compass-outline',
  travel:         'airplane-outline',
  food:           'restaurant-outline',
  sleep:          'bed-outline',
  home:           'home-outline',
  mosque:         'business-outline',
};

const iconFor = (slug) => CATEGORY_ICON[slug] || 'book-outline';

export default function DuaCategoryList() {
  const router = useRouter();

  const [categories, setCategories] = useState([]);
  const [featured,   setFeatured]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await duaApi.getCategories();
      if (res.success) {
        setCategories(res.data.categories || []);
        setFeatured(res.data.featured_today || null);
      }
    } catch (err) {
      setError("Couldn't load duas right now — check your connection and pull to refresh.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderCategory = ({ item }) => (
    <TouchableOpacity
      style={styles.categoryTile}
      onPress={() =>
        router.push({ pathname: '/dua-detail', params: { slug: item.slug } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.dua_count} duas`}
    >
      <View style={styles.tileIconWrap}>
        <Ionicons name={iconFor(item.slug)} size={22} color={colors.teal} />
      </View>
      <Text style={styles.tileName} numberOfLines={2}>{item.name}</Text>
      <Text style={styles.tileCount}>
        {item.dua_count} {item.dua_count === 1 ? 'dua' : 'duas'}
      </Text>
    </TouchableOpacity>
  );

  const FeaturedHeader = featured ? (
    <TouchableOpacity
      style={styles.featuredCard}
      onPress={() =>
        router.push({
          pathname: '/dua-detail',
          params: { slug: featured.category?.slug || '', highlight: featured.slug || '' },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`Today's dua: ${featured.name}`}
    >
      <Text style={styles.featuredEyebrow}>Today&apos;s dua</Text>

      {featured.category?.name ? (
        <Text style={styles.featuredCategory}>{featured.category.name}</Text>
      ) : null}
      <Text style={styles.featuredTitle}>{featured.name}</Text>

      <Text
        style={styles.featuredArabic}
        numberOfLines={3}
        accessibilityLanguage="ar"
      >
        {featured.arabic_text}
      </Text>

      {featured.translation ? (
        <Text style={styles.featuredTranslation} numberOfLines={2}>
          {featured.translation}
        </Text>
      ) : null}
    </TouchableOpacity>
  ) : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Duas &amp; Adhkar</Text>
        <Text style={styles.headerSubtitle}>Daily supplications for every moment</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.teal} />
          <Text style={styles.loadingText}>Loading duas…</Text>
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
          data={categories}
          keyExtractor={(item) => item.id}
          renderItem={renderCategory}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          ListHeaderComponent={
            <>
              {FeaturedHeader}
              {categories.length > 0 ? (
                <Text style={styles.sectionEyebrow}>All categories</Text>
              ) : null}
            </>
          }
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.teal]}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="book-outline" size={36} color={colors.inkGhost} />
              <Text style={styles.emptyText}>
                No duas yet. Ask the coordinator to run the dua sync.
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

  listContent: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 24 },

  // Featured card — warm parchment tint, no arrow decoration, no shadow.
  featuredCard: {
    backgroundColor: colors.goldSoft,
    borderRadius: 12,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  featuredEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gold,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  featuredCategory: { fontSize: 11, color: colors.inkFaint, marginBottom: 2 },
  featuredTitle:    { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  featuredArabic: {
    ...ARABIC_TEXT_STYLE,
    fontFamily: fonts.arabic,
    fontSize: 22,
    lineHeight: 44,
    marginBottom: 10,
  },
  featuredTranslation: {
    fontSize: 14,
    color: colors.inkMuted,
    lineHeight: 22,
  },

  sectionEyebrow: {
    fontSize: 11,
    color: colors.inkFaint,
    marginBottom: 10,
    marginLeft: 4,
  },

  // Two-column tile grid
  gridRow: { gap: 10, marginBottom: 10 },
  categoryTile: {
    flex: 1,
    backgroundColor: colors.paper,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 108,
  },
  tileIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    marginBottom: 10,
  },
  tileName:  { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  tileCount: { fontSize: 11, color: colors.inkFaint },

  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 10 },
  loadingText: { fontSize: 13, color: colors.inkFaint },
  errorText:   { fontSize: 14, color: colors.inkMuted, textAlign: 'center', lineHeight: 22 },
  emptyText:   { fontSize: 14, color: colors.inkFaint, textAlign: 'center', lineHeight: 22 },
  retryBtn:    { marginTop: 4, backgroundColor: colors.teal, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 8 },
  retryText:   { color: colors.paper, fontWeight: '700', fontSize: 14 },
});
