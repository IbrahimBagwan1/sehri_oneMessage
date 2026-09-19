// @ts-nocheck
import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { colors } from '../../theme';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * User tabs. Track + Donate are member-only; for guests we hide them
 * from the tab bar with `href: null`. The routes still exist so any
 * deep-linked navigation renders GuestGate (defensive).
 */
export default function UserTabLayout() {
  const isGuest = useAuthStore((s) => s.isGuest);
  const restricted = isGuest ? null : undefined; // null hides the tab

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
          height: Platform.OS === 'ios' ? 84 : 62,
          paddingTop: 6,
          paddingBottom: Platform.OS === 'ios' ? 24 : 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="track"
        options={{
          title: 'Track',
          href: restricted,
          tabBarIcon: ({ color, size }) => <Ionicons name="location-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="donate"
        options={{
          title: 'Donate',
          href: restricted,
          tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Dua"
        options={{
          title: 'Dua',
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="Quran"
        options={{
          title: 'Qur’an',
          tabBarIcon: ({ color, size }) => <Ionicons name="library-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
