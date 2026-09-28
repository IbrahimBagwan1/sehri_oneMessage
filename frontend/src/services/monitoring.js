import * as Sentry from '@sentry/react-native';

/**
 * monitoring.js — crash reporting, with personal data scrubbed.
 *
 * Off unless EXPO_PUBLIC_SENTRY_DSN is set, and always off in development
 * (a developer's red box is the report there). In release builds it
 * captures crashes and unhandled errors so problems reported as "the app
 * closed" can be found and fixed.
 *
 * WHAT NEVER LEAVES THE PHONE
 *   • no user identity — setUser is never called, sendDefaultPii is off
 *   • no screenshots or view hierarchy (they would show names, addresses,
 *     chat messages)
 *   • phone numbers, push tokens and JWTs are masked in every message,
 *     exception and breadcrumb, and query strings are cut from URLs
 *   • console breadcrumbs are dropped entirely
 * The privacy policy and the store privacy forms list crash data as
 * collected, not linked to identity, used for app functionality.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

const PHONE = /(?<![0-9A-Za-z-])(?:\+?91[\s-]?)?([6-9]\d)\d{5}(\d{3})(?![0-9A-Za-z-])/g;
const PUSH_TOKEN = /Expo(nent)?PushToken\[[^\]]*\]/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

export const scrub = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .replace(JWT, '[jwt]')
    .replace(PUSH_TOKEN, 'ExponentPushToken[…]')
    .replace(PHONE, (_m, head, tail) => `${head}*****${tail}`);
};

const stripQuery = (url) => (typeof url === 'string' ? url.split('?')[0] : url);

const scrubEvent = (event) => {
  delete event.user;
  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    event.request.url = stripQuery(event.request.url);
  }
  if (event.message) event.message = scrub(event.message);
  for (const ex of event.exception?.values || []) {
    ex.value = scrub(ex.value);
  }
  event.breadcrumbs = (event.breadcrumbs || []).filter((b) => b.category !== 'console').map(scrubBreadcrumb);
  return event;
};

function scrubBreadcrumb(b) {
  const out = { ...b, message: scrub(b.message) };
  if (out.data) {
    out.data = { ...out.data };
    if (out.data.url) out.data.url = stripQuery(out.data.url);
    delete out.data.body;
    delete out.data.response;
  }
  return out;
}

let started = false;

export const initMonitoring = () => {
  if (started || !DSN || __DEV__) return false;
  Sentry.init({
    dsn: DSN,
    environment: process.env.EXPO_PUBLIC_APP_ENV || 'production',
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    // Crash reports only; no performance tracing, which would record
    // screen and request timings the privacy forms do not declare.
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: (b) => (b.category === 'console' ? null : scrubBreadcrumb(b)),
  });
  started = true;
  return true;
};

/** Report an error caught by an error boundary. No-op when monitoring is off. */
export const reportError = (error) => {
  if (!started) return;
  try { Sentry.captureException(error); } catch (_) { /* never let reporting crash the app */ }
};

export const wrapRoot = (Component) => (DSN && !__DEV__ ? Sentry.wrap(Component) : Component);
