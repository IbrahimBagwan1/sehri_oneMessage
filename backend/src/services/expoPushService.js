'use strict';

/**
 * expoPushService.js — send push notifications through Expo's servers.
 *
 * We picked Expo Push over the Firebase Admin SDK because:
 *   • the frontend is an Expo app; expo-notifications gives us an
 *     "ExponentPushToken[...]" token natively
 *   • Expo forwards to FCM (Android) and APNs (iOS) transparently
 *   • no server-side SDK, no service-account JSON, no credentials
 *   • one HTTP endpoint, no npm dep beyond axios (already installed)
 *
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * Public surface:
 *   • isExpoPushToken(token)  — cheap validator
 *   • sendPush({ to, title, body, data? })
 *   • sendPushBatch(messages)  — up to 100 messages per call
 */

const axios = require('axios');
const logger = require('../utils/logger');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const REQUEST_TIMEOUT_MS = 8000;

// Expo tokens look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]".
// The bracketed body is opaque, we only assert the shape.
const EXPO_TOKEN_PATTERN = /^ExponentPushToken\[[A-Za-z0-9_-]+\]$/;

const isExpoPushToken = (token) =>
  typeof token === 'string' && EXPO_TOKEN_PATTERN.test(token);

/**
 * Send one push. Returns the receipt-id if Expo accepted it, or null on
 * failure. Never throws — push is a "nice to have" side effect, it must
 * not fail the parent request (usually a location push from the rider).
 *
 * @param {object} msg
 * @param {string} msg.to      — Expo push token (must pass isExpoPushToken)
 * @param {string} msg.title
 * @param {string} msg.body
 * @param {object} [msg.data]  — optional custom data payload (delivered to
 *                                the notification handler on device)
 * @param {number} [msg.badge] — iOS badge count (Android ignores)
 */
const sendPush = async ({ to, title, body, data, badge }) => {
  if (!isExpoPushToken(to)) {
    logger.warn(`[expoPush] Refusing to send: not a valid Expo push token: ${to}`);
    return null;
  }

  const payload = {
    to,
    title,
    body,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    ...(data ? { data } : {}),
    ...(badge != null ? { badge } : {}),
  };

  try {
    const res = await axios.post(EXPO_PUSH_URL, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
    });
    const ticket = res.data?.data;
    if (Array.isArray(ticket) ? ticket[0]?.status === 'error' : ticket?.status === 'error') {
      const first = Array.isArray(ticket) ? ticket[0] : ticket;
      logger.warn(`[expoPush] Ticket error: ${first.message || 'unknown'}`);
      return null;
    }
    return Array.isArray(ticket) ? ticket[0]?.id : ticket?.id || null;
  } catch (err) {
    logger.warn(`[expoPush] send failed: ${err.message}`);
    return null;
  }
};

/**
 * Send many pushes in one HTTP round-trip. Expo caps at 100 messages
 * per POST; we chunk automatically. Invalid tokens are dropped before
 * the request so a single bad token can't sink the batch.
 *
 * @param {Array<object>} messages — same shape as sendPush's argument
 * @returns {Promise<{ sent: number, dropped: number }>}
 */
const sendPushBatch = async (messages) => {
  const valid = (messages || []).filter((m) => isExpoPushToken(m?.to));
  const dropped = (messages?.length || 0) - valid.length;
  if (valid.length === 0) return { sent: 0, dropped };

  const CHUNK = 100;
  let sent = 0;
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK).map((m) => ({
      to: m.to,
      title: m.title,
      body: m.body,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      ...(m.data ? { data: m.data } : {}),
      ...(m.badge != null ? { badge: m.badge } : {}),
    }));

    try {
      const res = await axios.post(EXPO_PUSH_URL, chunk, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
      });
      const tickets = Array.isArray(res.data?.data) ? res.data.data : [];
      const ok = tickets.filter((t) => t.status !== 'error').length;
      sent += ok;
      const errors = tickets.length - ok;
      if (errors > 0) {
        logger.warn(`[expoPush] batch chunk: ${errors}/${tickets.length} ticket errors`);
      }
    } catch (err) {
      logger.warn(`[expoPush] batch chunk failed: ${err.message}`);
    }
  }
  return { sent, dropped };
};

module.exports = { sendPush, sendPushBatch, isExpoPushToken };
