// @ts-nocheck
import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';
import { colors } from '../theme';

/**
 * Entry route. Three landing paths:
 *
 *   1. Not authenticated + not guest → /(auth)/login
 *   2. Guest (browsing without an account) → /(user) (restricted tabs)
 *   3. Signed in → /(user) | /(admin) | /super-admin based on active_role
 */
export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isGuest         = useAuthStore((s) => s.isGuest);
  const isHydrated      = useAuthStore((s) => s.isHydrated);
  const active_role     = useAuthStore((s) => s.active_role);
  const hydrate         = useAuthStore((s) => s.hydrate);

  useEffect(() => { hydrate(); }, []);

  if (!isHydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.paperSoft }}>
        <ActivityIndicator size="large" color={colors.teal} />
      </View>
    );
  }

  // Guests land on the user tabs — Track + Donate are hidden from the
  // tab bar for them, and Home + Profile have inline sign-in invites.
  if (isGuest) {
    return <Redirect href="/(user)" />;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  if (active_role === 'super_admin') return <Redirect href="/super-admin/superadmin-dashboard" />;
  if (active_role === 'admin')       return <Redirect href="/(admin)" />;
  return <Redirect href="/(user)" />;
}
