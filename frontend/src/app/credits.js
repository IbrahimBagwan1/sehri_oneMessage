import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Card, Header, SectionHeader } from '../components/ui';
import { colors, space, type } from '../theme';

/**
 * Sources & credits — where every piece of religious content in the app
 * comes from, and the open-source work it is built on.
 *
 * Religious text is something members must be able to trust, and App
 * Review (1.1.5) expects quotations of scripture to be accurate and
 * attributable. So each source is named here, with the translator or
 * compiler, and reachable from the Qur'an and Dua tabs as well as Profile —
 * guests included.
 */

const SOURCES = [
  {
    heading: 'The Holy Qur’an',
    items: [
      {
        title: 'Arabic text',
        body: 'Uthmani script, retrieved through the Quran.com (Quran Foundation) API.',
        url: 'https://quran.com',
      },
      {
        title: 'English translation',
        body: 'Saheeh International. © Saheeh International; retrieved through the Quran.com API.',
      },
      {
        title: 'Verse of the day',
        body: 'Selected daily by islamic.app and shown with the Saheeh International translation.',
        url: 'https://islamic.app',
      },
    ],
  },
  {
    heading: 'Duas',
    items: [
      {
        title: 'Hisn al-Muslim (Fortress of the Muslim)',
        body: 'Supplications compiled by Sa’id ibn Ali ibn Wahf al-Qahtani. Each dua shows its hadith reference (for example Sahih al-Bukhari, Sahih Muslim).',
      },
    ],
  },
  {
    heading: 'Prayer times',
    items: [
      {
        title: 'AlAdhan',
        body: 'Daily timings from the AlAdhan API (University of Islamic Sciences, Karachi method), with an on-device calculation as a fallback when it cannot be reached.',
        url: 'https://aladhan.com',
      },
      {
        title: 'Hijri date',
        body: 'Umm al-Qura calendar.',
      },
    ],
  },
  {
    heading: 'Software',
    items: [
      { title: 'Amiri typeface', body: 'By Khaled Hosny, under the SIL Open Font License.' },
      { title: 'adhan-js', body: 'Prayer time calculation library by Batoul Apps, MIT License.' },
      { title: 'Ionicons', body: 'Icons by the Ionic team, MIT License.' },
      { title: 'Maps', body: 'Map data and routes © Google.' },
      { title: 'Expo and React Native', body: 'MIT License.' },
    ],
  },
];

export default function CreditsScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Sources & credits" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          Every verse, translation and supplication in OneMessage comes from an
          established source. If you spot an error, please tell us through
          Feedback so it can be checked and corrected.
        </Text>

        {SOURCES.map((section) => (
          <View key={section.heading} style={styles.section}>
            <SectionHeader title={section.heading} />
            <Card>
              {section.items.map((item, i) => (
                <View key={item.title} style={[styles.item, i > 0 && styles.itemRule]}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemBody}>{item.body}</Text>
                  {item.url ? (
                    <Text
                      style={styles.link}
                      onPress={() => Linking.openURL(item.url).catch(() => {})}
                      accessibilityRole="link"
                      accessibilityLabel={`${item.title} website, opens in your browser`}
                    >
                      {item.url.replace(/^https:\/\//, '')}
                    </Text>
                  ) : null}
                </View>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { padding: space[4], paddingBottom: space[8] },
  intro: { ...type.body, marginBottom: space[2] },
  section: { marginTop: space[4] },
  item: { paddingVertical: space[2] },
  itemRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ruleSoft },
  itemTitle: { ...type.h2, fontSize: 15 },
  itemBody: { ...type.body, fontSize: 14, marginTop: 2 },
  link: { ...type.meta, color: colors.tealDark, marginTop: 4, textDecorationLine: 'underline' },
});
