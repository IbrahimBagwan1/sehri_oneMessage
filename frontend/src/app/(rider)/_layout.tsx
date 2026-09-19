// @ts-nocheck
import React, { useEffect } from 'react';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View, Platform } from 'react-native';
import { useRiderStore } from '../../store/useRiderStore';
import { colors } from '../../theme';

export default function RiderLayout() {
  const router          = useRouter();
  const segments        = useSegments();
  const hydrate         = useRiderStore((s) => s.hydrate);
  const isHydrated      = useRiderStore((s) => s.isHydrated);
  const isAuthenticated = useRiderStore((s) => s.isAuthenticated);

  useEffect(() => { hydrate(); }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const onLoginScreen = segments[segments.length - 1] === 'login';
    if (!isAuthenticated && !onLoginScreen) router.replace('/(rider)/login');
    if (isAuthenticated && onLoginScreen) router.replace('/(rider)/map');
  }, [isHydrated, isAuthenticated, segments]);

  const onLoginScreen = segments[segments.length - 1] === 'login';

  if (!isHydrated && !onLoginScreen) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.paperSoft }}>
        <ActivityIndicator size="large" color={colors.teal} />
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: onLoginScreen
          ? { display: 'none' }
          : {
              backgroundColor: colors.paper,
              borderTopColor: colors.ruleSoft,
              height: Platform.OS === 'ios' ? 84 : 62,
              paddingTop: 6,
              paddingBottom: Platform.OS === 'ios' ? 24 : 6,
            },
      }}
    >
      <Tabs.Screen name="map"        options={{ title: 'Map',        tabBarIcon: ({ color, size }) => <Ionicons name="map-outline"  size={size} color={color} /> }} />
      <Tabs.Screen name="deliveries" options={{ title: 'Deliveries', tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="login"      options={{ href: null }} />
    </Tabs>
  );
}