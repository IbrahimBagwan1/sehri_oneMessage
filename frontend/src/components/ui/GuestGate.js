import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, space, type } from '../../theme';
import Button from './Button';
import RubStar from './RubStar';

/**
 * GuestGate — full-screen "sign in to unlock" panel.
 *
 * Rendered by any screen that a guest technically can't use (Track,
 * Donate, Profile, etc.). The tab bar hides these tabs from guests
 * already; this component is the defensive fallback if a guest lands
 * on the route through a deep link or push navigation.
 *
 * Tone matches the app's existing empty/error primitives — plain,
 * welcoming, one clear next action.
 *
 *   title    e.g. "Live tracking is for members"
 *   message  one sentence describing what they'd unlock
 *   icon     Ionicons name (default: person-add-outline)
 */
export default function GuestGate({
  title = 'Sign in to unlock this',
  message,
  icon = 'lock-closed-outline',
  style,
}) {
  const router = useRouter();

  return (
    <View style={[styles.container, style]}>
      <View style={styles.ornamentTop}>
        <View style={styles.ornamentRule} />
        <RubStar size={13} />
        <View style={styles.ornamentRule} />
      </View>

      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={28} color={colors.tealDark} />
      </View>

      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.actions}>
        <Button
          label="Sign in"
          onPress={() => router.push('/(auth)/login')}
          fullWidth
          icon="log-in-outline"
        />
        <Button
          label="Create an account"
          variant="secondary"
          onPress={() => router.push('/(auth)/register')}
          fullWidth
          style={{ marginTop: space[2] }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: space[6],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paperSoft,
  },
  ornamentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    width: 180,
    marginBottom: space[6],
  },
  ornamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },

  iconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space[4],
  },
  title:   { ...type.h1, textAlign: 'center', marginBottom: space[2] },
  message: { ...type.body, textAlign: 'center', color: colors.inkMuted, maxWidth: 320, lineHeight: 22 },
  actions: { alignSelf: 'stretch', marginTop: space[6], maxWidth: 340 },
});
