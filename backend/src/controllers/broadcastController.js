'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { sendPushBatch, isExpoPushToken } = require('../services/expoPushService');
const logger = require('../utils/logger');

const { Broadcast, User, Location } = db;

// ---------------------------------------------------------------------------
// Internal — resolve every descendant location under a given root, plus
// the root itself. Users are attached at leaf (zone/address) level, so a
// target of "Bangalore" must expand through every child.
//
// We walk the parent chain in one query (all locations, cheap table),
// then BFS in memory. Returns a Set<string> of location ids.
// ---------------------------------------------------------------------------
const collectDescendantIds = async (rootId) => {
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
    const cur = queue.shift();
    const kids = childrenOf.get(cur) || [];
    for (const k of kids) {
      if (!ids.has(k)) {
        ids.add(k);
        queue.push(k);
      }
    }
  }
  return ids;
};

// ---------------------------------------------------------------------------
// POST /api/broadcasts
// Access: super_admin
// Body: { title?, message, target_location_id? }
//
// Sends a push to every approved user in the target audience and stores
// an audit row. Delivery is best-effort — the response returns once the
// audit row is saved even if some pushes are still in flight, but we do
// wait for the Expo batch to complete so the delivered_count is honest.
// ---------------------------------------------------------------------------
const sendBroadcast = async (req, res, next) => {
  try {
    const { title, message, target_location_id } = req.body;
    const { id: senderId } = req.auth;

    if (!message || !message.trim()) {
      return error(res, { statusCode: 400, message: 'Message is required' });
    }
    if (message.trim().length > 2000) {
      return error(res, { statusCode: 400, message: 'Message is too long (max 2000 characters)' });
    }
    if (title && title.length > 120) {
      return error(res, { statusCode: 400, message: 'Title is too long (max 120 characters)' });
    }

    // Resolve audience — either every approved user, or those attached
    // to a location under the target.
    let locationIds = null;
    if (target_location_id) {
      const rootLocation = await Location.findByPk(target_location_id);
      if (!rootLocation) {
        return error(res, { statusCode: 404, message: 'Target zone not found' });
      }
      locationIds = Array.from(await collectDescendantIds(target_location_id));
    }

    const audience = await User.findAll({
      where: {
        status: 'approved',
        ...(locationIds ? { location_id: { [Op.in]: locationIds } } : {}),
      },
      attributes: ['id', 'fcm_token'],
      raw: true,
    });

    const recipient_count = audience.length;

    // Build push batch — drop anything that isn't a live Expo token.
    const messages = audience
      .map((u) => u.fcm_token)
      .filter(isExpoPushToken)
      .map((token) => ({
        to: token,
        title: title?.trim() || 'OneMessage',
        body: message.trim(),
        data: { kind: 'broadcast' },
      }));

    let sent = 0;
    if (messages.length > 0) {
      const result = await sendPushBatch(messages);
      sent = result.sent || 0;
      if (result.dropped) {
        logger.info(`[broadcast] dropped ${result.dropped} invalid tokens`);
      }
    }

    const row = await Broadcast.create({
      title: title?.trim() || null,
      message: message.trim(),
      target_location_id: target_location_id || null,
      sent_by: senderId,
      recipient_count,
      delivered_count: sent,
    });

    return success(res, {
      statusCode: 201,
      message: `Broadcast sent to ${sent} of ${recipient_count} recipient(s)`,
      data: {
        id: row.id,
        title: row.title,
        message: row.message,
        target_location_id: row.target_location_id,
        recipient_count,
        delivered_count: sent,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/broadcasts
// Access: super_admin
// Query: ?limit=50 (default 50, max 200)
//
// Returns the broadcast history, newest first, with the target zone name
// resolved so the UI can render "sent to <zone name>" without a second call.
// ---------------------------------------------------------------------------
const listBroadcasts = async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

    const rows = await Broadcast.findAll({
      order: [['created_at', 'DESC']],
      limit,
      include: [
        {
          model: Location,
          as: 'target_location',
          attributes: ['id', 'name', 'type'],
        },
      ],
    });

    const data = rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      target_location: r.target_location
        ? { id: r.target_location.id, name: r.target_location.name, type: r.target_location.type }
        : null,
      recipient_count: r.recipient_count,
      delivered_count: r.delivered_count,
      created_at: r.created_at,
    }));

    return success(res, {
      statusCode: 200,
      message: 'Broadcast history fetched',
      data: { broadcasts: data },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { sendBroadcast, listBroadcasts };
