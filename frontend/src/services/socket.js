import { io } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../api/client';

/**
 * socket.js — one shared Socket.IO connection for the whole app.
 *
 * The URL is derived from API_BASE_URL by stripping the trailing /api
 * (Socket.IO shares the HTTP server on the backend, but attaches at
 * the root path — not under /api). We authenticate the handshake with
 * the access token stored in SecureStore, so the backend's
 * verifyAccessToken middleware can identify the user.
 *
 * Consumers:
 *   • connect()        — call once after login (or on app open if a
 *                        token already exists)
 *   • getSocket()      — the live client, or null if not connected
 *   • subscribeTracking({ zone_id })   — join the zone room for live
 *                                        rider position updates
 *   • unsubscribeTracking(...)         — leave that room
 *   • disconnect()     — call on logout
 *
 * The singleton keeps at most one connection open. Multiple screens
 * can safely subscribe/unsubscribe independently.
 */

let socket = null;
let connecting = null; // in-flight promise, so parallel calls dedupe

// Derive the base socket URL from the REST base URL.
// e.g. https://host/api  →  https://host
const socketBaseUrl = () => API_BASE_URL.replace(/\/api\/?$/, '');

export const getSocket = () => socket;
export const isConnected = () => Boolean(socket?.connected);

/**
 * Connect (or return the existing connection). Idempotent — safe to
 * call from screens on mount; the promise resolves once the handshake
 * is complete, or rejects with a friendly error.
 */
export const connect = async () => {
  if (socket?.connected) return socket;
  if (connecting) return connecting;

  connecting = (async () => {
    const token = await SecureStore.getItemAsync('access_token');
    if (!token) {
      // Guest mode or logged out — no socket, no crash.
      connecting = null;
      return null;
    }

    // If a socket exists but is disconnected, tear it down before
    // rebuilding so listeners don't stack.
    if (socket) {
      try { socket.removeAllListeners(); socket.disconnect(); } catch (_) { /* noop */ }
      socket = null;
    }

    socket = io(socketBaseUrl(), {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 10000,
    });

    // Log connection state transitions to console (dev) — silent in prod.
    if (__DEV__) {
      socket.on('connect',       () => console.log('[socket] connected as', socket.id));
      socket.on('disconnect',    (reason) => console.log('[socket] disconnected:', reason));
      socket.on('connect_error', (err) => console.log('[socket] connect_error:', err.message));
    }

    // Wait for the initial connect (or a hard error) before resolving.
    return new Promise((resolve) => {
      const done = (ok) => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        connecting = null;
        resolve(ok ? socket : null);
      };
      const onConnect = () => done(true);
      const onError   = () => done(false);
      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
      // Safety timeout — 8s.
      setTimeout(() => done(socket?.connected), 8000);
    });
  })();

  return connecting;
};

export const disconnect = () => {
  if (!socket) return;
  try { socket.removeAllListeners(); socket.disconnect(); } catch (_) { /* noop */ }
  socket = null;
  connecting = null;
};

/**
 * Ask the backend to join us to a live-tracking zone room. The socket
 * server then emits `rider_position` events into that room. `zone_id`
 * is optional — the backend falls back to whatever zone the JWT carries.
 */
export const subscribeTracking = async ({ zone_id } = {}) => {
  const s = socket?.connected ? socket : await connect();
  if (!s) return false;
  s.emit('subscribe_tracking', { zone_id });
  return true;
};

export const unsubscribeTracking = ({ zone_id } = {}) => {
  if (!socket?.connected) return;
  socket.emit('unsubscribe_tracking', { zone_id });
};
