// @ts-nocheck
import React, { useEffect } from 'react';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRiderStore } from '../../store/useRiderStore';
// Imported for its side effect: the background location task must be
// DEFINED before the OS can deliver to it, including on a cold relaunch
// where the OS starts the app specifically to hand over a location.
import '../../services/riderLocationTask';
import { colors } from '../../theme';

export default function RiderLayout() {
  const router          = useRouter();
  const segments        = useSegments();
  const hydrate         = useRiderStore((s) => s.hydrate);
  const isHydrated      = useRiderStore((s) => s.isHydrated);
  const isAuthenticated = useRiderStore((s) => s.isAuthenticated);
  const syncDeliveryState = useRiderStore((s) => s.syncDeliveryState);

  useEffect(() => { hydrate(); }, []);

  // Reconcile once the session is known. The OS owns the location task, so
  // it outlives the JS context: the app can be killed mid-round and
  // relaunched with isDelivering reset to false while the feed is still
  // running. Without this the rider is shown "Start delivery" for a round
  // that never stopped, and tapping it would double-start.
  useEffect(() => {
    if (isHydrated && isAuthenticated) syncDeliveryState();
  }, [isHydrated, isAuthenticated, syncDeliveryState]);

  useEffect(() => {
    if (!isHydrated) return;
    const onLoginScreen = segments[segments.length - 1] === 'login';
    if (!isAuthenticated && !onLoginScreen) router.replace('/(rider)/login');
    if (isAuthenticated && onLoginScreen) router.replace('/(rider)/map');
  }, [isHydrated, isAuthenticated, segments]);

  const onLoginScreen = segments[segments.length - 1] === 'login';

  // Safe-area-aware bottom padding — see comment in (user)/_layout.tsx.
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const barHeight = 56 + bottomPad;

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
              height: barHeight,
              paddingTop: 6,
              paddingBottom: bottomPad,
            },
      }}
    >
      <Tabs.Screen name="map"        options={{ title: 'Map',        tabBarIcon: ({ color, size }) => <Ionicons name="map-outline"  size={size} color={color} /> }} />
      <Tabs.Screen name="deliveries" options={{ title: 'Deliveries', tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="login"      options={{ href: null }} />
    </Tabs>
  );
}