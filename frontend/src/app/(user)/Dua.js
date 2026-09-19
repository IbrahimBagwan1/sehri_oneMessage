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

// -----------------------------------------------------------------------------
// Dua landing screen — categories list + featured-of-the-day card.
//
// The categories endpoint already returns the featured dua inline so
// this screen fully populates in one HTTP round-trip.
// -----------------------------------------------------------------------------

// Icons per category slug. Unmapped slugs get a neutral book icon.
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
      setError(err.response?.data?.message || 'Could not load duas');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderCategory = ({ item }) => (
    <TouchableOpacity
      style={styles.categoryCard}
      onPress={() =>
        router.push({ pathname: '/dua-detail', params: { slug: item.slug } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.dua_count} duas`}
    >
      <View style={styles.categoryIconBox}>
        <Ionicons name={iconFor(item.slug)} size={22} color="#0D9488" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.categoryName}>{item.name}</Text>
        {item.description ? (
          <Text style={styles.categoryDesc} numberOfLines={1}>{item.description}</Text>
        ) : null}
        <Text style={styles.categoryCount}>
          {item.dua_count} {item.dua_count === 1 ? 'dua' : 'duas'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
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
      accessibilityLabel={`Featured dua of the day: ${featured.name}`}
    >
      <View style={styles.featuredHeader}>
        <View style={styles.featuredBadge}>
          <Ionicons name="star" size={11} color="#B45309" />
          <Text style={styles.featuredBadgeText}>Featured today</Text>
        </View>
        {featured.category?.name ? (
          <Text style={styles.featuredCategory}>{featured.category.name}</Text>
        ) : null}
      </View>

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

      <View style={styles.featuredFooter}>
        <Text style={styles.featuredReadLink}>Read full dua</Text>
        <Ionicons name="arrow-forward" size={14} color="#0D9488" />
      </View>
    </TouchableOpacity>
  ) : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Duas &amp; Adhkar</Text>
        <Text style={styles.headerSubtitle}>Daily supplications, categorized</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0D9488" />
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
          data={categories}
          keyExtractor={(item) => item.id}
          renderItem={renderCategory}
          ListHeaderComponent={FeaturedHeader}
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
                No duas yet — the sync may still be running.
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

  listContent: { padding: 14 },

  // Featured card
  featuredCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  featuredHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  featuredBadge:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  featuredBadgeText:{ fontSize: 11, fontWeight: '700', color: '#B45309' },
  featuredCategory: { fontSize: 11, color: '#92400E', fontWeight: '600' },
  featuredTitle:    { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 10 },
  featuredArabic: {
    fontSize: 20,
    lineHeight: 40,
    color: '#0F172A',
    writingDirection: 'rtl',
    textAlign: 'right',
    marginBottom: 8,
  },
  featuredTranslation: { fontSize: 13, color: '#475569', lineHeight: 20, marginBottom: 10 },
  featuredFooter:   { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'flex-end' },
  featuredReadLink: { fontSize: 12, color: '#0D9488', fontWeight: '700' },

  // Category rows
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  categoryIconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#F0FDF9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  categoryName:  { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  categoryDesc:  { fontSize: 12, color: '#64748B', marginTop: 1 },
  categoryCount: { fontSize: 11, color: '#94A3B8', marginTop: 2 },

  centered:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  errorText:   { fontSize: 13, color: '#DC2626', textAlign: 'center' },
  emptyText:   { fontSize: 13, color: '#94A3B8', textAlign: 'center' },
  retryBtn:    { backgroundColor: '#0D9488', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginTop: 4 },
  retryText:   { color: '#FFF', fontWeight: '700', fontSize: 14 },
});
