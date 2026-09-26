'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');
const expoPush = require('./expoPushService');

const { User, Location } = db;

/**
 * notificationService.js — who gets told what.
 *
 * The split with expoPushService is deliberate: that file knows Expo's wire
 * protocol and nothing about this app; this one knows the app's audiences
 * and nothing about HTTP. Triggers call only this file, so "notify the
 * masjid zone" never has to become a token query at the call site.
 *
 * TOKEN MODEL — one token per user, on users.fcm_token, deliberately.
 * Signing in on a second device replaces the first, so notifications follow
 * the device you last signed in on. That was a product decision, not an
 * oversight: the alternative (a device_tokens table) was considered and
 * rejected as unnecessary for this community's usage. The consequence to
 * remember when reading this file is that "a user" and "a device" are the
 * same thing here, and there is exactly one row to clear when a token dies.
 *
 * DEAD TOKENS. Every send passes `forgetTokens` down as the invalid-token
 * callback, so a token Expo reports as DeviceNotRegistered — immediately in
 * its ticket, or later in its receipt — is nulled out. Nothing accumulates
 * and nothing is retried forever.
 *
 * FAILURE STANCE. Every method resolves, never rejects. A notification is a
 * side effect of something more important (a vote opening, a rider starting
 * a run) and must never be the reason that thing fails.
 */

/**
 * Clear tokens Expo told us are dead. Scoped to the exact token string
 * rather than the user: if they have already signed in elsewhere and
 * written a fresh token, this must not wipe the new one.
 */
const forgetTokens = async (tokens) => {
  if (!tokens?.length) return 0;
  const [count] = await User.update(
    { fcm_token: null },
    { where: { fcm_token: { [Op.in]: tokens } } }
  );
  if (count) logger.info(`[notify] cleared ${count} dead push token(s)`);
  return count;
};

/** Turn a list of users into Expo messages, skipping anyone unreachable. */
const buildMessages = (users, { title, body, data }) =>
  (users || [])
    .map((u) => u.fcm_token)
    .filter((t) => expoPush.isExpoPushToken(t))
    .map((to) => ({ to, title, body, ...(data ? { data } : {}) }));

/**
 * Deliver to an explicit set of users.
 * Everything else in this file funnels through here.
 */
const sendToUsers = async (users, notification, context = 'notify') => {
  const messages = buildMessages(users, notification);
  if (messages.length === 0) {
    logger.info(`[notify] ${context}: nobody reachable, nothing sent`);
    return { sent: 0, failed: 0, dropped: 0, recipients: 0 };
  }
  const result = await expoPush.sendPushBatch(messages, forgetTokens);
  logger.info(
    `[notify] ${context}: recipients=${messages.length} `
    + `sent=${result.sent} failed=${result.failed} dropped=${result.dropped}`
  );
  return { ...result, recipients: messages.length };
};

/** One person. */
const sendToUser = async (userId, notification) => {
  if (!userId) return { sent: 0, failed: 0, dropped: 0, recipients: 0 };
  const user = await User.findByPk(userId, { attributes: ['id', 'fcm_token'] });
  return sendToUsers(user ? [user] : [], notification, `user:${userId}`);
};

/**
 * Every approved member whose location sits anywhere under `zoneId`.
 *
 * Members attach to the tree at PG level, so "the masjid zone" means the
 * zone row plus every descendant of it. The whole locations table is a few
 * dozen rows, so it is walked in memory rather than with a recursive CTE —
 * the same approach broadcastController already uses.
 */
const descendantLocationIds = async (rootId) => {
  const rows = await Location.findAll({
    attributes: ['id', 'parent_id'],
    where: { is_active: true },
    raw: true,
  });
  const childrenOf = new Map();
  for (const r of rows) {
    if (!r.parent_id) continue;
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id).push(r.id);
  }
  const ids = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const child of childrenOf.get(queue.shift()) || []) {
      if (!ids.has(child)) { ids.add(child); queue.push(child); }
    }
  }
  return [...ids];
};

const sendToZone = async (zoneId, notification) => {
  if (!zoneId) return sendToAll(notification);
  const locationIds = await descendantLocationIds(zoneId);
  const users = await User.findAll({
    where: {
      status: 'approved',
      location_id: { [Op.in]: locationIds },
      fcm_token: { [Op.ne]: null },
    },
    attributes: ['id', 'fcm_token'],
  });
  return sendToUsers(users, notification, `zone:${zoneId}`);
};

/** Everyone approved, app-wide. */
const sendToAll = async (notification) => {
  const users = await User.findAll({
    where: { status: 'approved', fcm_token: { [Op.ne]: null } },
    attributes: ['id', 'fcm_token'],
  });
  return sendToUsers(users, notification, 'all');
};

/**
 * Fire-and-forget wrapper for trigger points.
 *
 * Triggers sit inside request handlers that must stay fast and must not fail
 * because a push failed, so they call this rather than awaiting. Errors are
 * logged and swallowed; the caller gets nothing back on purpose.
 */
const notifyInBackground = (promiseFactory, context) => {
  Promise.resolve()
    .then(promiseFactory)
    .catch((err) => logger.error(`[notify] ${context} failed: ${err.name}: ${err.message}`));
};

module.exports = {
  sendToUser,
  sendToUsers,
  sendToZone,
  sendToAll,
  notifyInBackground,
  forgetTokens,
  descendantLocationIds,
};
