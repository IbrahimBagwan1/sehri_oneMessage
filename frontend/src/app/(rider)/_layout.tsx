import React, { useEffect } from 'react';
import { Tabs, useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View } from 'react-native';
import { useRiderStore } from '../../store/useRiderStore';

export default function RiderLayout() {
  const router          = useRouter();
  const segments        = useSegments();
  const hydrate         = useRiderStore((state) => state.hydrate);
  const isHydrated      = useRiderStore((state) => state.isHydrated);
  const isAuthenticated = useRiderStore((state) => state.isAuthenticated);

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const onLoginScreen = segments[segments.length - 1] === 'login';
    if (!isAuthenticated && !onLoginScreen) {
      router.replace('/(rider)/login');
    }
    if (isAuthenticated && onLoginScreen) {
      router.replace('/(rider)/map');
    }
  }, [isHydrated, isAuthenticated, segments]);

  const onLoginScreen = segments[segments.length - 1] === 'login';

  // Show spinner only while hydrating and not already on login screen
  if (!isHydrated && !onLoginScreen) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' }}>
        <ActivityIndicator size="large" color="#0D9488" />
      </View>
    );
  }

  // Always render Tabs — hide tab bar on login screen to avoid the
  // "Stack before Root Layout" error when switching navigators dynamically.
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0D9488',
        tabBarInactiveTintColor: '#94A3B8',
        headerShown: false,
        // Hide the tab bar completely on the login screen
        tabBarStyle: onLoginScreen
          ? { display: 'none' }
          : {
              backgroundColor: '#FFFFFF',
              borderTopColor: '#E2E8F0',
              elevation: 8,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.06,
              shadowRadius: 4,
            },
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="deliveries"
        options={{
          title: 'Deliveries',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="login"
        options={{ href: null }}
      />
    </Tabs>
  );
}
