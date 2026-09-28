import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './ui';
import { colors, space, type } from '../theme';
import { reportError } from '../services/monitoring';

/**
 * AppErrorScreen — what a member sees instead of a blank screen when a
 * screen throws while rendering.
 *
 * Exported from the root layout as expo-router's ErrorBoundary, so it
 * catches any route. "Try again" re-renders the route (expo-router's
 * retry); most failures are a bad response from a flaky network and clear
 * on the second attempt. The error itself is reported to crash monitoring
 * (scrubbed — see services/monitoring.js) and never shown raw to the member.
 */
export default function AppErrorScreen({ error, retry }) {
  useEffect(() => { if (error) reportError(error); }, [error]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Ionicons name="cloud-offline-outline" size={48} color={colors.tealDark} />
        <Text style={styles.title} accessibilityRole="header">Something went wrong</Text>
        <Text style={styles.message}>
          This screen could not load. Your account and data are safe. Check your
          connection and try again.
        </Text>
        <Button label="Try again" icon="refresh-outline" onPress={retry} style={{ marginTop: space[5] }} />
        {__DEV__ && error?.message ? <Text style={styles.dev}>{error.message}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6] },
  title: { ...type.h2, color: colors.ink, marginTop: space[4], textAlign: 'center' },
  message: { ...type.body, color: colors.inkMuted, marginTop: space[2], textAlign: 'center' },
  dev: { ...type.meta, color: colors.danger, marginTop: space[4], textAlign: 'center' },
});
