// @ts-nocheck
import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { colors } from '../../theme';

export default function AdminTabLayout() {
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
      <Tabs.Screen name="index"         options={{ title: 'Dashboard', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline"           size={size} color={color} /> }} />
      <Tabs.Screen name="users"         options={{ title: 'Users',     tabBarIcon: ({ color, size }) => <Ionicons name="people-outline"         size={size} color={color} /> }} />
      <Tabs.Screen name="special-cases" options={{ title: 'Special',   tabBarIcon: ({ color, size }) => <Ionicons name="alert-circle-outline"   size={size} color={color} /> }} />
      <Tabs.Screen name="feedback"      options={{ title: 'Feedback',  tabBarIcon: ({ color, size }) => <Ionicons name="chatbubble-outline"     size={size} color={color} /> }} />
      <Tabs.Screen name="chat"          options={{ title: 'Chat',      tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline"    size={size} color={color} /> }} />
    </Tabs>
  );
}