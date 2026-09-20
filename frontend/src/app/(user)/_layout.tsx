// @ts-nocheck
import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * User tabs. Track + Donate + Chat are member-only; for guests we
 * hide them from the tab bar with `href: null`. The routes still
 * exist so any deep-linked navigation renders GuestGate (defensive).
 *
 * Layout note — the tab bar's bottom padding uses the device's real
 * safe-area inset (max with a small minimum) so labels + icons never
 * sit under Android's 3-button/gesture navigation bar or the iOS
 * home indicator. A fixed paddingBottom (as we had before) worked on
 * some devices and got covered by the gesture bar on others.
 */
export default function UserTabLayout() {
  const isGuest = useAuthStore((s) => s.isGuest);
  const restricted = isGuest ? null : undefined; // null hides the tab

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
        name="chat"
        options={{
          title: 'Chat',
          href: restricted,
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} />,
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
