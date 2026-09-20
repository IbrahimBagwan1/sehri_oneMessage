import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// API base URL is read from an EXPO_PUBLIC_ env var so every developer
// can point at their own ngrok tunnel (or LAN IP) without editing this
// file. Expo inlines EXPO_PUBLIC_* variables at bundle time from
// `frontend/.env` — see `frontend/.env.example` for the format.
//
// Fallback: an unreachable placeholder that makes the mistake loud. If
// you see requests going here, you forgot to set EXPO_PUBLIC_API_BASE_URL.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://SET-EXPO_PUBLIC_API_BASE_URL-in-frontend-dotenv.invalid/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
  timeout: 10000,
});

// ---------------------------------------------------------------------------
// Request interceptor — attach the stored JWT to every outgoing request.
// ---------------------------------------------------------------------------
apiClient.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ---------------------------------------------------------------------------
// Response interceptor — silent token refresh.
//
// If any request comes back 401 (expired access token), we call
// POST /api/auth/refresh-token once, replay the original request with
// the new access token, and continue transparently. If refresh itself
// fails, we clear the tokens and fire an event so the app can navigate
// to the login screen.
//
// Concurrency: many requests may 401 at the same time. We use a
// single-flight promise (`refreshInFlight`) so only ONE refresh call
// happens; subsequent 401s await the same promise. This avoids a
// stampede and the "refresh with a stale refresh token" race.
//
// Guards:
//   • Don't try to refresh a request that's ALREADY /auth/refresh-token
//     itself — that would loop forever.
//   • Don't try to refresh if there's no refresh token stored.
//   • Only retry each original request once (config.__isRetry flag).
// ---------------------------------------------------------------------------
let refreshInFlight = null;
const onAuthFailureListeners = new Set();

/**
 * Subscribe to hard-logout events. Called when refresh fails (invalid
 * or expired refresh token). The auth store hooks this to run its
 * logout() flow and route back to /(auth)/login.
 * Returns an unsubscribe function.
 */
export const onAuthFailure = (fn) => {
  onAuthFailureListeners.add(fn);
  return () => onAuthFailureListeners.delete(fn);
};

const fireAuthFailure = () => {
  for (const fn of onAuthFailureListeners) {
    try { fn(); } catch (_) { /* noop */ }
  }
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error?.config;
    const status   = error?.response?.status;

    // Not a 401, or the request has already been retried once, or we
    // don't have a config to replay — bail out unchanged.
    if (
      status !== 401 ||
      !original ||
      original.__isRetry ||
      original.url?.includes('/auth/refresh-token') ||
      original.url?.includes('/auth/login')
    ) {
      return Promise.reject(error);
    }

    const stored = await SecureStore.getItemAsync('refresh_token');
    if (!stored) {
      fireAuthFailure();
      return Promise.reject(error);
    }

    try {
      // Single-flight: coalesce concurrent 401s into one refresh call.
      if (!refreshInFlight) {
        refreshInFlight = (async () => {
          const resp = await axios.post(
            `${API_BASE_URL}/auth/refresh-token`,
            { refreshToken: stored },
            {
              timeout: 10000,
              headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
              },
            }
          );
          const { accessToken, refreshToken } = resp.data?.data || {};
          if (!accessToken || !refreshToken) {
            throw new Error('Refresh response missing tokens');
          }
          await SecureStore.setItemAsync('access_token',  accessToken);
          await SecureStore.setItemAsync('refresh_token', refreshToken);
          return accessToken;
        })().finally(() => { refreshInFlight = null; });
      }
      const newAccess = await refreshInFlight;

      // Replay the original request with the new token.
      original.__isRetry = true;
      original.headers   = { ...(original.headers || {}), Authorization: `Bearer ${newAccess}` };
      return apiClient(original);
    } catch (refreshErr) {
      // Refresh failed — clear stored tokens + notify the app to log
      // the user out cleanly. We deliberately do NOT delete the guest
      // flag or user_data here; useAuthStore.logout() handles the full
      // cleanup so any UI subscribing to auth state resets in one go.
      try {
        await SecureStore.deleteItemAsync('access_token');
        await SecureStore.deleteItemAsync('refresh_token');
      } catch (_) { /* noop */ }
      fireAuthFailure();
      return Promise.reject(error);
    }
  }
);

export default apiClient;
