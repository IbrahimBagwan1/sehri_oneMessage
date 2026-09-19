import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import apiClient from '../api/client';

// -----------------------------------------------------------------------------
// Auth store — three mutually exclusive states:
//
//   1. Signed out            isAuthenticated=false, isGuest=false, user=null
//   2. Browsing as guest     isAuthenticated=false, isGuest=true,  user=null
//   3. Signed in             isAuthenticated=true,  isGuest=false, user={...}
//
// Guest mode is the "browse without committing" path: read-only Islamic
// content (prayer times, Quran, Duas) works, but interactive features
// (Sehri poll, live tracking, donations, chat, profile) require a real
// account. Guest state is persisted to SecureStore so the app comes
// back in guest mode on relaunch without prompting.
// -----------------------------------------------------------------------------

const GUEST_KEY = 'is_guest';

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isGuest: false,
  isHydrated: false,
  active_role: null,         // 'user' | 'admin' | 'super_admin' (never set for guests)
  available_roles: [],

  // ---------------------------------------------------------------------------
  // Called once at app startup — reads persisted tokens + role from SecureStore
  // ---------------------------------------------------------------------------
  hydrate: async () => {
    try {
      const token     = await SecureStore.getItemAsync('access_token');
      const userData  = await SecureStore.getItemAsync('user_data');
      const roleData  = await SecureStore.getItemAsync('active_role');
      const rolesData = await SecureStore.getItemAsync('available_roles');
      const guestFlag = await SecureStore.getItemAsync(GUEST_KEY);

      if (token && userData) {
        // Signed-in state takes precedence over any stale guest flag.
        set({
          accessToken: token,
          user: JSON.parse(userData),
          isAuthenticated: true,
          isGuest: false,
          active_role: roleData || 'user',
          available_roles: rolesData ? JSON.parse(rolesData) : [],
        });
      } else if (guestFlag === 'true') {
        set({ isGuest: true, isAuthenticated: false });
      }
    } catch {
      // Corrupted storage — treat as fully signed out.
    } finally {
      set({ isHydrated: true });
    }
  },

  // ---------------------------------------------------------------------------
  // Called after successful sign-in. Clears any leftover guest flag.
  // ---------------------------------------------------------------------------
  setAuth: async (user, accessToken, refreshToken, active_role, available_roles) => {
    await SecureStore.setItemAsync('access_token', accessToken);
    await SecureStore.setItemAsync('refresh_token', refreshToken);
    await SecureStore.setItemAsync('user_data', JSON.stringify(user));
    await SecureStore.setItemAsync('active_role', active_role);
    await SecureStore.setItemAsync('available_roles', JSON.stringify(available_roles));
    // Signing in exits guest mode.
    await SecureStore.deleteItemAsync(GUEST_KEY);

    set({
      user,
      accessToken,
      isAuthenticated: true,
      isGuest: false,
      active_role,
      available_roles,
    });
  },

  // ---------------------------------------------------------------------------
  // Enter guest mode — no backend call, no token issued. The app just
  // opens with restricted features hidden. Prayer/Quran/Dua endpoints
  // are public so they still work.
  // ---------------------------------------------------------------------------
  continueAsGuest: async () => {
    await SecureStore.setItemAsync(GUEST_KEY, 'true');
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isGuest: true,
      active_role: null,
      available_roles: [],
    });
  },

  // ---------------------------------------------------------------------------
  // Switch to a different role — calls backend, swaps tokens
  // ---------------------------------------------------------------------------
  switchRole: async (requestedRole) => {
    try {
      const response = await apiClient.post('/auth/switch-role', { role: requestedRole });
      const { accessToken, refreshToken, active_role, available_roles, profile } = response.data.data;

      if (active_role === 'rider') {
        await SecureStore.setItemAsync('rider_access_token',  accessToken);
        await SecureStore.setItemAsync('rider_refresh_token', refreshToken);
        await SecureStore.setItemAsync('rider_data',          JSON.stringify(profile));
        return { success: true, isRider: true };
      }

      await SecureStore.setItemAsync('access_token',     accessToken);
      await SecureStore.setItemAsync('refresh_token',    refreshToken);
      await SecureStore.setItemAsync('user_data',        JSON.stringify(profile));
      await SecureStore.setItemAsync('active_role',      active_role);
      await SecureStore.setItemAsync('available_roles',  JSON.stringify(available_roles));

      set({
        accessToken,
        user: profile,
        active_role,
        available_roles,
      });

      return { success: true, isRider: false };
    } catch (err) {
      throw err;
    }
  },

  // ---------------------------------------------------------------------------
  // Logout — clears everything, including any guest flag.
  // ---------------------------------------------------------------------------
  logout: async () => {
    await SecureStore.deleteItemAsync('access_token');
    await SecureStore.deleteItemAsync('refresh_token');
    await SecureStore.deleteItemAsync('user_data');
    await SecureStore.deleteItemAsync('active_role');
    await SecureStore.deleteItemAsync('available_roles');
    await SecureStore.deleteItemAsync(GUEST_KEY);

    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isGuest: false,
      active_role: null,
      available_roles: [],
    });
  },
}));
