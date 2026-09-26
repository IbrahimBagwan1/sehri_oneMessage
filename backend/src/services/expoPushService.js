'use strict';

/**
 * expoPushService.js — the transport layer for push. Nothing above this file
 * should know how Expo's API is shaped.
 *
 * WHY EXPO PUSH AND NOT THE FIREBASE ADMIN SDK
 * The app is an Expo app, so expo-notifications hands us an
 * "ExponentPushToken[...]" natively, and Expo fans out to FCM (Android) and
 * APNs (iOS) for us. Going direct to firebase-admin would mean holding a
 * service-account JSON on this server AND wiring APNs separately for iOS —
 * two credential systems instead of zero.
 *
 * Worth knowing, because it is commonly misread: FCM credentials are still
 * required either way. Expo uses FCM as its Android transport, so the choice
 * was never "Expo or Firebase", only who performs the fan-out. See the EAS
 * setup checklist in the project README.
 *
 * TICKETS vs RECEIPTS — the part that makes dead tokens go away.
 * Sending returns a TICKET per message, which only says Expo accepted it for
 * delivery. Whether FCM/APNs actually accepted it arrives later, in a
 * RECEIPT, fetched by ticket id. `DeviceNotRegistered` — the app was
 * uninstalled, or the token was rotated — only ever shows up in a receipt.
 * Polling for them is the only way to learn a token is dead; without it we
 * would push to uninstalled apps forever.
 *
 * ESM INTEROP: expo-server-sdk v6 is ESM-only and this backend is CommonJS,
 * so the SDK is pulled in with a cached dynamic import() rather than
 * require(). Node supports this in CJS; the alternative was pinning to an
 * old SDK release.
 */

const logger = require('../utils/logger');

// Expo asks for ~15 minutes before receipts are queryable. Anything sooner
// mostly returns "not ready yet" and wastes a round trip.
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

// A cap on how many ticket ids we hold waiting for their receipt check. A
// runaway trigger must not turn into unbounded memory.
const MAX_PENDING_TICKETS = 5000;

let _expoPromise = null;

/** The SDK's Expo class, imported once and cached. */
const loadExpo = async () => {
  if (!_expoPromise) {
    _expoPromise = import('expo-server-sdk').then((mod) => mod.Expo || mod.default?.Expo);
  }
  return _expoPromise;
};

let _client = null;
const getClient = async () => {
  const Expo = await loadExpo();
  if (!_client) _client = new Expo();
  return _client;
};

/**
 * Cheap shape check. Kept synchronous because call sites use it in filters
 * and validators where awaiting would be awkward; the SDK's own version is
 * the same regex.
 */
const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
const isExpoPushToken = (token) =>
  typeof token === 'string' && EXPO_TOKEN_PATTERN.test(token);

/**
 * Send a batch of messages.
 *
 * Never throws — push is a side effect, and a push failure must never fail
 * the request that triggered it (a vote, a rider going on shift).
 *
 * @param {Array<{to,title,body,data?,badge?}>} messages
 * @param {(tokens: string[]) => Promise<void>} [onInvalidTokens]
 *        Called with tokens Expo rejected outright. Also called later, from
 *        the deferred receipt check, for tokens that fail after acceptance.
 * @returns {Promise<{ sent: number, failed: number, dropped: number }>}
 */
const sendPushBatch = async (messages, onInvalidTokens) => {
  const valid = (messages || []).filter((m) => isExpoPushToken(m?.to));
  const dropped = (messages?.length || 0) - valid.length;
  if (valid.length === 0) return { sent: 0, failed: 0, dropped };

  let expo;
  let Expo;
  try {
    expo = await getClient();
    Expo = await loadExpo();
  } catch (err) {
    logger.error(`[push] expo-server-sdk failed to load: ${err.message}`);
    return { sent: 0, failed: valid.length, dropped };
  }

  const payloads = valid.map((m) => ({
    to: m.to,
    title: m.title,
    body: m.body,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    ...(m.data ? { data: m.data } : {}),
    ...(m.badge != null ? { badge: m.badge } : {}),
  }));

  // The SDK chunks to Expo's documented limit for us (100 at the time of
  // writing) rather than us hardcoding it.
  const chunks = expo.chunkPushNotifications(payloads);
  const ticketIds = [];
  const deadTokens = [];
  let sent = 0;
  let failed = 0;
  let cursor = 0;

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        // Tickets come back positionally, so this maps each one back to the
        // token that produced it.
        const token = payloads[cursor + i]?.to;
        if (ticket.status === 'ok') {
          sent += 1;
          if (ticket.id) ticketIds.push({ id: ticket.id, token });
          return;
        }
        failed += 1;
        if (ticket.details?.error === 'DeviceNotRegistered' && token) {
          deadTokens.push(token);
        } else {
          logger.warn(`[push] ticket error: ${ticket.details?.error || ticket.message}`);
        }
      });
    } catch (err) {
      failed += chunk.length;
      logger.warn(`[push] chunk send failed: ${err.message}`);
    }
    cursor += chunk.length;
  }

  if (deadTokens.length && typeof onInvalidTokens === 'function') {
    try { await onInvalidTokens(deadTokens); } catch (err) {
      logger.warn(`[push] invalid-token cleanup failed: ${err.message}`);
    }
  }

  // Schedule the receipt check. Deliberately fire-and-forget and unref'd:
  // it must not hold the event loop open, and a server restart losing a
  // pending check is harmless — the token simply gets cleaned up the next
  // time we push to it.
  if (ticketIds.length && typeof onInvalidTokens === 'function') {
    scheduleReceiptCheck(ticketIds, onInvalidTokens, Expo);
  }

  return { sent, failed, dropped };
};

/**
 * Look up receipts after the delay and report tokens that turned out dead.
 * Exported (and callable with a zero delay) so tests do not have to wait a
 * quarter of an hour.
 */
const checkReceipts = async (ticketIds, onInvalidTokens, ExpoClass) => {
  if (!ticketIds?.length) return { checked: 0, dead: 0 };

  let expo;
  let Expo;
  try {
    expo = await getClient();
    Expo = ExpoClass || (await loadExpo());
  } catch (err) {
    logger.error(`[push] receipt check could not load the SDK: ${err.message}`);
    return { checked: 0, dead: 0 };
  }

  const byId = new Map(ticketIds.map((t) => [t.id, t.token]));
  const ids = [...byId.keys()];
  const dead = [];
  let checked = 0;

  for (const chunk of expo.chunkPushNotificationReceiptIds(ids)) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const [id, receipt] of Object.entries(receipts)) {
        checked += 1;
        if (receipt.status !== 'error') continue;
        const token = byId.get(id);
        if (receipt.details?.error === 'DeviceNotRegistered' && token) {
          dead.push(token);
        } else {
          // MessageTooBig / MessageRateExceeded / MismatchSenderId are OUR
          // problems, not the device's — log them rather than punishing the
          // token by deleting it.
          logger.warn(`[push] receipt error ${receipt.details?.error}: ${receipt.message}`);
        }
      }
    } catch (err) {
      logger.warn(`[push] receipt chunk failed: ${err.message}`);
    }
  }

  if (dead.length && typeof onInvalidTokens === 'function') {
    try { await onInvalidTokens(dead); } catch (err) {
      logger.warn(`[push] receipt cleanup failed: ${err.message}`);
    }
  }
  if (checked) {
    logger.info(`[push] receipts checked=${checked} dead=${dead.length}`);
  }
  return { checked, dead: dead.length };
};

let pendingCount = 0;

const scheduleReceiptCheck = (ticketIds, onInvalidTokens, Expo) => {
  if (pendingCount + ticketIds.length > MAX_PENDING_TICKETS) {
    logger.warn('[push] receipt backlog is full — skipping this batch\'s check');
    return;
  }
  pendingCount += ticketIds.length;

  const timer = setTimeout(() => {
    pendingCount = Math.max(0, pendingCount - ticketIds.length);
    checkReceipts(ticketIds, onInvalidTokens, Expo)
      .catch((err) => logger.warn(`[push] deferred receipt check failed: ${err.message}`));
  }, RECEIPT_DELAY_MS);

  // Node keeps running for a pending timer otherwise, which would delay a
  // clean shutdown by up to 15 minutes.
  if (typeof timer.unref === 'function') timer.unref();
};

module.exports = {
  isExpoPushToken,
  sendPushBatch,
  checkReceipts,
  RECEIPT_DELAY_MS,
};
