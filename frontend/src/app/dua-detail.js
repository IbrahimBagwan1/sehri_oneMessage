import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  LayoutAnimation,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { duaApi } from '../api/dua';
import { colors, fonts, ARABIC_TEXT_STYLE } from '../components/islamicTheme';

// -----------------------------------------------------------------------------
// Dua detail — expandable cards for every dua in a category.
//
// A `highlight` query param (from the featured-today link) auto-expands
// the target card and scrolls to it after layout completes.
//
// There used to be a `UIManager.setLayoutAnimationEnabledExperimental(true)`
// opt-in here for Android. That was the old-architecture flag; under the
// New Architecture (Fabric/Bridgeless, on by default since Expo SDK 57 /
// RN 0.86) layout animations need no opt-in and the call is a documented
// no-op that warns on every import of this route. Removed — the
// LayoutAnimation.configureNext in toggle() below is what actually
// drives the expand/collapse.
// -----------------------------------------------------------------------------

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
      setError('This category link is missing.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await duaApi.getCategory(slug);
      if (res.success) {
        setData(res.data);
        if (highlight) {
          setExpanded({ [highlight]: true });
        } else if (res.data.duas?.length === 1) {
          setExpanded({ [res.data.duas[0].slug]: true });
        }
      }
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        setError("This category isn't loaded yet. Ask the coordinator to run the dua sync.");
      } else {
        setError("Couldn't load this category — check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [slug, highlight]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Once content is on screen, scroll to the highlighted card.
  useEffect(() => {
    if (!highlight || !data) return;
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
        <ActivityIndicator size="large" color={colors.teal} />
        <Text style={styles.loadingText}>Loading duas…</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Header router={router} title="Duas" />
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

  const { category, duas = [] } = data || {};

  return (
    <SafeAreaView style={styles.container}>
      <Header router={router} title={category?.name || 'Duas'} subtitle={`${duas.length} ${duas.length === 1 ? 'dua' : 'duas'}`} />

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
            <Ionicons name="book-outline" size={36} color={colors.inkGhost} />
            <Text style={styles.emptyText}>No duas found in this category.</Text>
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
                  <Text style={styles.cardIndex}>{idx + 1}</Text>
                  <Text style={styles.cardTitle} numberOfLines={isOpen ? undefined : 2}>
                    {d.name}
                  </Text>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.inkFaint}
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
                        <View style={styles.divider} />
                        <Text style={styles.transliteration}>{d.transliteration}</Text>
                      </>
                    ) : null}

                    {d.translation ? (
                      <>
                        <View style={styles.divider} />
                        <Text style={styles.translation}>{d.translation}</Text>
                      </>
                    ) : null}

                    {d.source ? (
                      <View style={styles.sourceRow}>
                        <Ionicons name="library-outline" size={12} color={colors.inkGhost} />
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

// -----------------------------------------------------------------------------
// Shared header — used by loading / error / content states.
// -----------------------------------------------------------------------------
function Header({ router, title, subtitle }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="arrow-back" size={22} color={colors.inkMuted} />
      </TouchableOpacity>
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      <View style={{ width: 30 }} />
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
  backBtn:        { padding: 4 },
  headerCenter:   { flex: 1 },
  headerTitle:    { fontSize: 17, fontWeight: '700', color: colors.ink },
  headerSubtitle: { fontSize: 12, color: colors.inkFaint, marginTop: 2 },

  scrollContent:       { padding: 14, paddingBottom: 32 },
  categoryDescription: { fontSize: 13, color: colors.inkFaint, marginBottom: 14, lineHeight: 20 },

  card: {
    backgroundColor: colors.paper,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardIndex: {
    // Plain teal numeral — reads as a list index rather than a badge.
    fontSize: 13,
    fontWeight: '700',
    color: colors.tealDark,
    minWidth: 20,
  },
  cardTitle:  { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },

  cardBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },

  arabicText: {
    ...ARABIC_TEXT_STYLE,
    fontFamily: fonts.arabic,
    fontSize: 22,
    lineHeight: 48,
    marginBottom: 4,
  },

  // Thin gold rule separates Arabic → transliteration → translation.
  divider: {
    height: 1,
    backgroundColor: colors.goldBorder,
    opacity: 0.5,
    marginVertical: 12,
  },

  transliteration: {
    fontSize: 14,
    color: colors.inkMuted,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  translation: {
    fontSize: 15,
    color: colors.ink,
    lineHeight: 24,
  },

  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  sourceText: { fontSize: 11, color: colors.inkGhost },

  loadingText: { fontSize: 13, color: colors.inkFaint },
  errorText:   { fontSize: 14, color: colors.inkMuted, textAlign: 'center', lineHeight: 22 },
  emptyText:   { fontSize: 14, color: colors.inkFaint, textAlign: 'center', lineHeight: 22 },
  retryBtn:    { marginTop: 4, backgroundColor: colors.teal, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 8 },
  retryText:   { color: colors.paper, fontWeight: '700', fontSize: 14 },
});
