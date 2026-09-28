import axios from 'axios';
import { getSecure, setSecure, deleteSecure } from '../services/secureStorage';

// ---------------------------------------------------------------------------
// API base URL — from EXPO_PUBLIC_API_BASE_URL, inlined by Expo at bundle
// time (frontend/.env locally; eas.json / EAS environment variables for
// store builds). See frontend/.env.example.
//
// A release build must talk to the API over HTTPS: tokens and members'
// personal data travel on every request. A build that was bundled without
// the variable, or with a development http:// address, falls back to an
// unreachable placeholder so the mistake is loud rather than a silent
// cleartext connection.
// ---------------------------------------------------------------------------
const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || '';
const isInsecureInRelease = !__DEV__ && !/^https:\/\//i.test(configuredBaseUrl);

export const API_BASE_URL = !configuredBaseUrl || isInsecureInRelease
  ? 'https://SET-EXPO_PUBLIC_API_BASE_URL-to-an-https-url.invalid/api'
  : configuredBaseUrl;

// Only needed when developing through an ngrok tunnel; never sent to a
// production API.
const devHeaders = /ngrok/i.test(API_BASE_URL) ? { 'ngrok-skip-browser-warning': 'true' } : {};

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json', ...devHeaders },
  timeout: 15000,
});

// ---------------------------------------------------------------------------
// Two sessions can be live in one app: the member session (whatever role the
// member is using) and, for a member who is also a rider, the rider session.
// Each has its own token pair in SecureStore. A request picks its session
// with `authScope: 'rider'` (default: the member session); rider requests
// also pass `authToken` explicitly so a rider call can never go out with the
// member's token.
// ---------------------------------------------------------------------------
const SCOPES = {
  member: { access: 'access_token', refresh: 'refresh_token' },
  rider:  { access: 'rider_access_token', refresh: 'rider_refresh_token' },
};

apiClient.interceptors.request.use(
  async (config) => {
    const scope = SCOPES[config.authScope] || SCOPES.member;
    const token = config.authToken || (await getSecure(scope.access));
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// ---------------------------------------------------------------------------
// Session-ended listeners — the auth store (member) and rider store (rider)
// subscribe so they can sign the person out and return to the login screen.
// ---------------------------------------------------------------------------
const listeners = { member: new Set(), rider: new Set() };

export const onAuthFailure = (fn, scope = 'member') => {
  listeners[scope].add(fn);
  return () => listeners[scope].delete(fn);
};

const fireAuthFailure = (scope) => {
  for (const fn of listeners[scope]) {
    try { fn(); } catch (_) { /* noop */ }
  }
};

const clearScope = async (scope) => {
  try {
    await deleteSecure(SCOPES[scope].access);
    await deleteSecure(SCOPES[scope].refresh);
  } catch (_) { /* noop */ }
};

/** Thrown when the server has definitively ended the session. */
class SessionEndedError extends Error {}

// One refresh in flight per scope: many requests expiring together share it.
const inFlight = { member: null, rider: null };

/**
 * Exchange the stored refresh token for a new pair and store it.
 *
 * Signs the person out ONLY when the server says the session is over (401 /
 * 403 from the refresh endpoint). A network error or timeout leaves the
 * tokens alone and just fails this attempt — the previous version cleared
 * the session on ANY refresh failure, so a moment of bad signal logged
 * people out.
 *
 * REFRESH_SUPERSEDED means another context on this device (the rider's
 * background location task, typically) rotated the token a moment ago. The
 * new pair is already in SecureStore; use it.
 *
 * @returns {Promise<string>} the new access token
 */
export const refreshSession = (scopeName = 'member') => {
  if (inFlight[scopeName]) return inFlight[scopeName];
  const scope = SCOPES[scopeName];

  inFlight[scopeName] = (async () => {
    const sent = await getSecure(scope.refresh);
    if (!sent) throw new SessionEndedError('no refresh token');
    try {
      const resp = await axios.post(
        `${API_BASE_URL}/auth/refresh-token`,
        { refreshToken: sent },
        { timeout: 15000, headers: { 'Content-Type': 'application/json', ...devHeaders } }
      );
      const { accessToken, refreshToken } = resp.data?.data || {};
      if (!accessToken || !refreshToken) throw new Error('Refresh response missing tokens');
      await setSecure(scope.access, accessToken);
      await setSecure(scope.refresh, refreshToken);
      return accessToken;
    } catch (err) {
      const status = err?.response?.status;
      const code = err?.response?.data?.code;
      if (status === 401 && code === 'REFRESH_SUPERSEDED') {
        await new Promise((r) => setTimeout(r, 600));
        const current = await getSecure(scope.refresh);
        const access = await getSecure(scope.access);
        if (current && current !== sent && access) return access;
      }
      if (status === 401 || status === 403) throw new SessionEndedError(code || 'session ended');
      throw err; // transient: offline, timeout, 5xx — keep the session
    }
  })().finally(() => { inFlight[scopeName] = null; });

  return inFlight[scopeName];
};

/** Ask the server to end the session this device holds. Best effort. */
export const revokeSession = async (scopeName = 'member') => {
  try {
    const token = await getSecure(SCOPES[scopeName].refresh);
    if (!token) return;
    await axios.post(
      `${API_BASE_URL}/auth/logout`,
      { refreshToken: token },
      { timeout: 8000, headers: { 'Content-Type': 'application/json', ...devHeaders } }
    );
  } catch (_) {
    // Offline: the server-side session simply expires on its own.
  }
};

// ---------------------------------------------------------------------------
// Response interceptor — silent refresh and replay on 401.
// ---------------------------------------------------------------------------
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;

    if (
      status !== 401
      || !original
      || original.__isRetry
      || original.url?.includes('/auth/refresh-token')
      || original.url?.includes('/auth/login')
      || original.url?.includes('/auth/logout')
      || original.url?.includes('/tracking/rider-login')
    ) {
      return Promise.reject(error);
    }

    // A request carrying an explicit token is refreshed only when it names
    // its session; an unscoped explicit token is never refreshed as the
    // member, which would replay it under the wrong identity.
    if (original.authToken && original.authScope !== 'rider') return Promise.reject(error);
    const scopeName = original.authScope === 'rider' ? 'rider' : 'member';
    const scope = SCOPES[scopeName];

    try {
      // Someone else may already have refreshed while this request was in
      // flight; if the stored token is newer than the one it was sent
      // with, replay with that instead of refreshing again.
      const sentWith = (original.headers?.Authorization || '').replace(/^Bearer /, '');
      const stored = await getSecure(scope.access);
      const token = stored && stored !== sentWith ? stored : await refreshSession(scopeName);

      original.__isRetry = true;
      original.authToken = scopeName === 'rider' ? token : original.authToken;
      original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` };
      return apiClient(original);
    } catch (refreshErr) {
      if (refreshErr instanceof SessionEndedError) {
        await clearScope(scopeName);
        fireAuthFailure(scopeName);
      }
      return Promise.reject(error);
    }
  }
);

export default apiClient;
