// @ts-nocheck
import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';

export default function AdminTabLayout() {
  // Safe-area-aware bottom padding — see comment in (user)/_layout.tsx.
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const barHeight = 56 + bottomPad;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.ruleSoft,
          height: barHeight,
          paddingTop: 6,
          paddingBottom: bottomPad,
        },
      }}
    >
      {/* Special-cases review is super-admin only (backend gates
          GET /api/polls/special-cases and POST .../allot with
          requireRole('super_admin')). The admin-side screen has been
          removed entirely — access lives under super-admin. */}
      <Tabs.Screen name="index"    options={{ title: 'Dashboard', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline"        size={size} color={color} /> }} />
      <Tabs.Screen name="users"    options={{ title: 'Users',     tabBarIcon: ({ color, size }) => <Ionicons name="people-outline"      size={size} color={color} /> }} />
      <Tabs.Screen name="feedback" options={{ title: 'Feedback',  tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-outline"  size={size} color={color} /> }} />
      <Tabs.Screen name="chat"     options={{ title: 'Chat',      tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}