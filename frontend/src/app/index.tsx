import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuthStore } from '../store/useAuthStore';

export default function Index() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isHydrated      = useAuthStore((state) => state.isHydrated);
  const active_role     = useAuthStore((state) => state.active_role);
  const hydrate         = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    hydrate();
  }, []);

  // Wait until SecureStore has been checked before redirecting
  if (!isHydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  // Route to the correct home based on stored active role
  if (active_role === 'super_admin') {
    return <Redirect href="/super-admin/superadmin-dashboard" />;
  }

  if (active_role === 'admin') {
    return <Redirect href="/(admin)" />;
  }

  return <Redirect href="/(user)" />;
}
