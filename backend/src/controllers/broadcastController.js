'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const notificationService = require('../services/notificationService');

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
// Access: admin (own zone only) or super_admin (anywhere)
// Body: { title?, message, target_location_id? }
//
// SCOPING follows the rule the rest of the admin surface already uses — a
// zone admin sees and acts on their own zone, a super admin sees everything
// (users list, feedback, poll stats all work this way). So a zone admin's
// broadcast is forced to their zone regardless of what they post, and any
// attempt to target elsewhere is refused rather than silently narrowed:
// being told "that is not your zone" is better than believing you reached
// people you did not.
//
// Sends to every approved user in the audience and stores an audit row.
// The Expo batch is awaited so delivered_count is honest.
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

    // A zone admin may only reach their own zone. Their token carries the
    // zone, so it is taken from there rather than trusted from the body.
    let targetId = target_location_id || null;
    if (req.auth.role === 'admin') {
      if (!req.auth.zone_location_id) {
        return error(res, {
          statusCode: 403,
          message: 'Your admin account has no zone assigned, so it cannot broadcast.',
        });
      }
      if (targetId && targetId !== req.auth.zone_location_id) {
        return error(res, {
          statusCode: 403,
          message: 'You can only broadcast to your own zone.',
        });
      }
      targetId = req.auth.zone_location_id;
    }

    // Resolve audience — either every approved user, or those attached
    // to a location under the target.
    let locationIds = null;
    if (targetId) {
      const rootLocation = await Location.findByPk(targetId);
      if (!rootLocation) {
        return error(res, { statusCode: 404, message: 'Target zone not found' });
      }
      locationIds = Array.from(await collectDescendantIds(targetId));
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

    // Through notificationService so dead tokens are cleaned up here the
    // same way they are for every other trigger.
    const result = await notificationService.sendToUsers(
      audience,
      {
        title: title?.trim() || 'OneMessage',
        body: message.trim(),
        data: { type: 'broadcast', route: '/(user)' },
      },
      `broadcast by ${req.auth.role} ${senderId}`
    );
    const sent = result.sent || 0;

    const row = await Broadcast.create({
      title: title?.trim() || null,
      message: message.trim(),
      target_location_id: targetId,
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

    // Same scoping as sending: a zone admin's history is their own zone's.
    const where = req.auth.role === 'admin'
      ? { target_location_id: req.auth.zone_location_id }
      : {};

    const rows = await Broadcast.findAll({
      where,
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
