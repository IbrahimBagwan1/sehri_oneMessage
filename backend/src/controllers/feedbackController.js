'use strict';

/**
 * feedbackController.js
 *
 * Endpoints:
 *   POST  /api/feedback            submitFeedback   (user)
 *   GET   /api/feedback/my         getMyFeedback    (user)
 *   GET   /api/feedback            listFeedback     (admin zone-scoped, super_admin all)
 *   PATCH /api/feedback/:id/read   markAsRead       (admin zone-scoped, super_admin any)
 *
 * Zone scoping: admins only see feedback from users in their own zone.
 * Super admins see all.
 */

const db = require('../models');
const { success, error } = require('../utils/response');
const {
  buildLocationInclude,
  resolveZoneFromLoaded,
} = require('../utils/zoneScope');

const { Feedback, User } = db;

const VALID_CATEGORIES = ['suggestion', 'complaint', 'bug', 'appreciation', 'other'];
const MAX_MESSAGE_LENGTH = 2000;

// ---------------------------------------------------------------------------
// POST /api/feedback
// Access: requireUserAccess
// Body: { category, message }
// ---------------------------------------------------------------------------
const submitFeedback = async (req, res, next) => {
  try {
    const { category, message } = req.body;

    if (!VALID_CATEGORIES.includes(category)) {
      return error(res, {
        statusCode: 400,
        message: `category must be one of: ${VALID_CATEGORIES.join(', ')}`,
      });
    }

    if (typeof message !== 'string' || message.trim().length === 0) {
      return error(res, { statusCode: 400, message: 'message is required' });
    }

    const trimmed = message.trim();
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return error(res, {
        statusCode: 400,
        message: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
      });
    }

    const feedback = await Feedback.create({
      user_id: req.actingUserId,
      category,
      message: trimmed,
      is_read: false,
    });

    return success(res, {
      statusCode: 201,
      message: 'Feedback submitted. Thank you!',
      data: {
        id: feedback.id,
        category: feedback.category,
        message: feedback.message,
        created_at: feedback.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/feedback/my
// Access: requireUserAccess
// Query: ?page=1&limit=20
// ---------------------------------------------------------------------------
const getMyFeedback = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const { count, rows } = await Feedback.findAndCountAll({
      where: { user_id: req.actingUserId },
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return success(res, {
      statusCode: 200,
      message: 'Feedback fetched',
      data: {
        total: count,
        page,
        limit,
        feedback: rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/feedback
// Access: admin (own zone), super_admin (all)
// Query: ?page=1&limit=20&category=...&is_read=true|false
// ---------------------------------------------------------------------------
const listFeedback = async (req, res, next) => {
  try {
    const { role, zone_location_id } = req.auth;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.category && VALID_CATEGORIES.includes(req.query.category)) {
      where.category = req.query.category;
    }
    if (req.query.is_read !== undefined) {
      where.is_read = req.query.is_read === 'true';
    }

    const { count, rows } = await Feedback.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone'],
          include: [buildLocationInclude()],
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    let visible = rows;
    if (role === 'admin') {
      visible = rows.filter((f) => {
        const zone = resolveZoneFromLoaded(f.user?.location);
        return zone && zone.id === zone_location_id;
      });
    }

    return success(res, {
      statusCode: 200,
      message: 'Feedback fetched',
      data: {
        total: count,
        page,
        limit,
        feedback: visible,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/feedback/:id/read
// Access: admin (own zone), super_admin (any)
//
// Marks feedback as read and records who did it. Idempotent — hitting
// this on already-read feedback returns 200 with the existing timestamps.
// ---------------------------------------------------------------------------
const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, zone_location_id } = req.auth;

    const feedback = await Feedback.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name'],
          include: [buildLocationInclude()],
        },
      ],
    });

    if (!feedback) {
      return error(res, { statusCode: 404, message: 'Feedback not found' });
    }

    if (role === 'admin') {
      const zone = resolveZoneFromLoaded(feedback.user?.location);
      if (!zone || zone.id !== zone_location_id) {
        return error(res, {
          statusCode: 403,
          message: 'You can only manage feedback from your own zone',
        });
      }
    }

    if (!feedback.is_read) {
      feedback.is_read = true;
      feedback.read_by = req.auth.id;
      feedback.read_at = new Date();
      await feedback.save();
    }

    return success(res, {
      statusCode: 200,
      message: 'Feedback marked as read',
      data: {
        id: feedback.id,
        is_read: feedback.is_read,
        read_at: feedback.read_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitFeedback,
  getMyFeedback,
  listFeedback,
  markAsRead,
};
