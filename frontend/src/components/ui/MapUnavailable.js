import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, type } from '../../theme';

/**
 * MapUnavailable — stands in for a Google map when this build has no Maps
 * key (see services/maps.js), so the screen around it keeps working instead
 * of the app crashing.
 *
 * Members see one plain sentence. Development builds also say which
 * variable is missing and how to fix it.
 */
export default function MapUnavailable({ style }) {
  const keyName = Platform.OS === 'ios' ? 'GOOGLE_MAPS_IOS_API_KEY' : 'GOOGLE_MAPS_ANDROID_API_KEY';
  return (
    <View style={[styles.container, style]} accessibilityRole="text">
      <Ionicons name="map-outline" size={40} color={colors.inkFaint} importantForAccessibility="no" />
      <Text style={styles.title}>Map not available</Text>
      <Text style={styles.body}>
        The map can&apos;t be shown in this version of the app. Everything else on
        this screen still works.
      </Text>
      {__DEV__ ? (
        <Text style={styles.dev}>
          Development build without a Google Maps key. Set {keyName} in
          frontend/.env, then run `npx expo prebuild` and rebuild the app.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[6],
    gap: space[2],
    backgroundColor: colors.paperSoft,
  },
  title: { ...type.h3, marginTop: space[1] },
  body:  { ...type.body, textAlign: 'center', maxWidth: 320 },
  dev:   { ...type.meta, textAlign: 'center', maxWidth: 320, marginTop: space[2] },
});
