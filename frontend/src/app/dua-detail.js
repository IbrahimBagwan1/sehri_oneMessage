import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { duaApi } from '../api/dua';

// -----------------------------------------------------------------------------
// Dua detail — expandable cards for every dua in a category.
//
// Enable LayoutAnimation on Android so the collapse/expand feels natural.
// A `highlight` query param (from the featured-today link) auto-expands
// and scrolls to a specific dua.
// -----------------------------------------------------------------------------
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function DuaDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const slug      = String(params.slug || '');
  const highlight = String(params.highlight || '');

  const scrollRef = useRef(null);
  const positions = useRef({}); // duaSlug → y offset

  const [data,     setData]     = useState(null); // { category, duas }
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [expanded, setExpanded] = useState({});   // duaSlug → bool

  const load = useCallback(async () => {
    if (!slug) {
      setError('Missing category slug');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await duaApi.getCategory(slug);
      if (res.success) {
        setData(res.data);
        // If we arrived via a highlight target, expand that one up-front.
        if (highlight) {
          setExpanded({ [highlight]: true });
        } else if (res.data.duas?.length === 1) {
          // Single-entry categories: default to expanded.
          setExpanded({ [res.data.duas[0].slug]: true });
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load duas');
    } finally {
      setLoading(false);
    }
  }, [slug, highlight]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // After the content lays out, jump to the highlighted card.
  useEffect(() => {
    if (!highlight || !data) return;
    // Wait a tick so onLayout has captured the position.
    const t = setTimeout(() => {
      const y = positions.current[highlight];
      if (y != null) {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [highlight, data]);

  const toggle = (duaSlug) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => ({ ...prev, [duaSlug]: !prev[duaSlug] }));
  };

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

  const { category, duas = [] } = data || {};

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#1F2937" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{category?.name || 'Duas'}</Text>
          <Text style={styles.headerSubtitle}>
            {duas.length} {duas.length === 1 ? 'dua' : 'duas'}
          </Text>
        </View>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {category?.description ? (
          <Text style={styles.categoryDescription}>{category.description}</Text>
        ) : null}

        {duas.length === 0 ? (
          <View style={[styles.centered, { paddingVertical: 40 }]}>
            <Ionicons name="book-outline" size={36} color="#CBD5E1" />
            <Text style={styles.emptyText}>No duas in this category yet.</Text>
          </View>
        ) : (
          duas.map((d, idx) => {
            const isOpen = !!expanded[d.slug];
            return (
              <View
                key={d.slug}
                style={styles.card}
                onLayout={(e) => {
                  positions.current[d.slug] = e.nativeEvent.layout.y;
                }}
              >
                <TouchableOpacity
                  style={styles.cardHeader}
                  onPress={() => toggle(d.slug)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${d.name}, ${isOpen ? 'collapse' : 'expand'}`}
                >
                  <View style={styles.indexBadge}>
                    <Text style={styles.indexText}>{idx + 1}</Text>
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={isOpen ? undefined : 2}>
                    {d.name}
                  </Text>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#64748B"
                  />
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.cardBody}>
                    <Text
                      style={styles.arabicText}
                      selectable
                      accessibilityLanguage="ar"
                    >
                      {d.arabic_text}
                    </Text>

                    {d.transliteration ? (
                      <>
                        <Text style={styles.sectionLabel}>Transliteration</Text>
                        <Text style={styles.transliteration}>{d.transliteration}</Text>
                      </>
                    ) : null}

                    {d.translation ? (
                      <>
                        <Text style={styles.sectionLabel}>Translation</Text>
                        <Text style={styles.translation}>{d.translation}</Text>
                      </>
                    ) : null}

                    {d.source ? (
                      <View style={styles.sourceRow}>
                        <Ionicons name="library-outline" size={12} color="#94A3B8" />
                        <Text style={styles.sourceText}>{d.source}</Text>
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

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

  scrollContent: { padding: 14, paddingBottom: 32 },

  categoryDescription: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 20,
  },

  card: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginBottom: 10,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  indexBadge: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#F0FDF9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  indexText:  { fontSize: 12, fontWeight: '700', color: '#0D9488' },
  cardTitle:  { flex: 1, fontSize: 14, fontWeight: '600', color: '#0F172A' },

  cardBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },

  arabicText: {
    fontSize: 22,
    lineHeight: 46,
    color: '#0F172A',
    writingDirection: 'rtl',
    textAlign: 'right',
    marginBottom: 14,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 4,
  },
  transliteration: {
    fontSize: 14,
    color: '#334155',
    fontStyle: 'italic',
    lineHeight: 22,
    marginBottom: 10,
  },
  translation: {
    fontSize: 15,
    color: '#0F172A',
    lineHeight: 22,
    marginBottom: 10,
  },

  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sourceText: { fontSize: 11, color: '#94A3B8' },

  errorText: { fontSize: 13, color: '#DC2626', textAlign: 'center' },
  emptyText: { fontSize: 13, color: '#94A3B8', textAlign: 'center' },
  retryBtn:  { backgroundColor: '#0D9488', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
});
