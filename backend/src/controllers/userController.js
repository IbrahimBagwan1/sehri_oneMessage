'use strict';

const db = require('../models');
const { success, error } = require('../utils/response');
const { Op } = require('sequelize');
const { buildLocationInclude, resolveZoneFromLoaded, locationIdsInZone } = require('../utils/zoneScope');
const { eraseUserAccount } = require('../services/accountDeletionService');
const chatGroupSync = require('../services/chatGroupSync');
const logger = require('../utils/logger');

const { User, Location, ProfileEditRequest } = db;

// What an admin list shows about a member. Deliberately excludes the push
// token and password hash that a bare findAll returned before.
const LIST_ATTRIBUTES = [
  'id', 'name', 'phone', 'gender', 'occupation', 'city', 'location_id',
  'address', 'status', 'is_phone_verified', 'last_login_at', 'created_at', 'updated_at',
];

// Without ?page, the list is still capped — no endpoint returns an
// unbounded table. Screens that need more pass page/limit (or q).
const UNPAGED_CAP = 1000;

// ---------------------------------------------------------------------------
// Fields the user is allowed to change via the profile-edit-request flow.
// Phone is the login identifier and stays immutable. Password is changed
// separately via the forgot-password flow. Status/is_phone_verified are
// admin-managed.
// ---------------------------------------------------------------------------
const EDITABLE_PROFILE_FIELDS = ['name', 'gender', 'occupation', 'city', 'location_id', 'address'];

// ---------------------------------------------------------------------------
// GET /api/users?status=pending
// - super_admin: sees users across all zones
// - admin: sees only users whose location resolves up to their own zone
//
// The location parent chain is eager-loaded in one query, then zone
// resolution happens in application memory — no N+1 DB queries.
// ---------------------------------------------------------------------------
const listUsers = async (req, res, next) => {
  try {
    const { status } = req.query;
    const { role, zone_location_id } = req.auth;

    // No exclusion clause needed: a deleted account has no users row at
    // all, so every row here belongs to a member who actually exists.
    const where = {};
    if (['pending', 'approved', 'rejected'].includes(status)) where.status = status;

    // Admins are scoped IN THE QUERY to their own zone's locations, rather
    // than loading every member in the community and filtering in memory.
    if (role === 'admin') {
      const ids = await locationIdsInZone(zone_location_id);
      if (ids.length === 0) {
        return success(res, { statusCode: 200, message: 'Users fetched successfully', data: [] });
      }
      where.location_id = { [Op.in]: ids };
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length >= 2) {
      const digits = q.replace(/\D/g, '');
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        ...(digits.length >= 3 ? [{ phone: { [Op.like]: `%${digits}%` } }] : []),
      ];
    }

    const paged = req.query.page !== undefined;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = paged
      ? Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50))
      : UNPAGED_CAP;

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: LIST_ATTRIBUTES,
      include: [buildLocationInclude()],
      order: [['createdAt', 'DESC']],
      limit,
      offset: paged ? (page - 1) * limit : 0,
      distinct: true,
    });

    if (!paged && count > UNPAGED_CAP) {
      logger.warn(`[users] list truncated to ${UNPAGED_CAP} of ${count} — the client should paginate`);
    }

    return success(res, {
      statusCode: 200,
      message: 'Users fetched successfully',
      // The unpaged shape (a bare array) is what existing screens read.
      data: paged ? { total: count, page, limit, users: rows } : rows,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/users/:id/status
// Body: { status: 'approved' | 'rejected' }
//
// Admins are scoped to users in their own zone; super_admins may act on
// anyone.
// ---------------------------------------------------------------------------
const updateUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { role, zone_location_id } = req.auth;

    if (!['approved', 'rejected'].includes(status)) {
      return error(res, {
        statusCode: 400,
        message: "Status must be 'approved' or 'rejected'",
      });
    }

    const user = await User.findByPk(id, {
      include: [buildLocationInclude()],
    });

    if (!user) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }

    if (role === 'admin') {
      const zone = resolveZoneFromLoaded(user.location);
      if (!zone || zone.id !== zone_location_id) {
        return error(res, {
          statusCode: 403,
          message: 'You can only manage users in your own zone',
        });
      }
    }

    user.status = status;
    await user.save();

    // Approval is what puts someone into their zone's chat; rejection takes
    // them back out. The zone is already resolved above for the admin scope
    // check, so this costs nothing extra.
    const userZone = resolveZoneFromLoaded(user.location);
    chatGroupSync.syncInBackground([userZone?.id], `user ${status}`);

    return success(res, {
      statusCode: 200,
      message: `User ${status} successfully`,
      data: { id: user.id, status: user.status },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/users/me
// Access: any authenticated user, admin, super_admin, or rider with a
//          linked user account (requireUserAccess).
//
// Returns the full profile of the calling user with their location
// ancestor chain eager-loaded so the client can render zone/address labels.
// ---------------------------------------------------------------------------
const getMe = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.actingUserId, {
      include: [buildLocationInclude()],
    });

    if (!user) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }

    const zone = resolveZoneFromLoaded(user.location);

    return success(res, {
      statusCode: 200,
      message: 'Profile fetched',
      data: {
        user,
        zone: zone ? { id: zone.id, name: zone.name } : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/users/request-profile-edit
// Access: any user with actingUserId.
// Body: { requested_changes: { name?, gender?, occupation?, city?, location_id?, address? } }
//
// Creates a pending ProfileEditRequest. Only one pending request per user
// at a time — the client should call GET /profile-edit-requests/mine first
// (or read this endpoint's 409 response) to know if they already have one.
// Nothing is applied to the users row until a super admin approves.
// ---------------------------------------------------------------------------
const requestProfileEdit = async (req, res, next) => {
  try {
    const { requested_changes: rawChanges } = req.body;

    if (!rawChanges || typeof rawChanges !== 'object' || Array.isArray(rawChanges)) {
      return error(res, {
        statusCode: 400,
        message: 'requested_changes must be an object of fields to update',
      });
    }

    // Strip anything not in the editable allow-list — never trust the client
    // to know which columns exist.
    const cleaned = {};
    for (const field of EDITABLE_PROFILE_FIELDS) {
      if (rawChanges[field] !== undefined && rawChanges[field] !== null && rawChanges[field] !== '') {
        cleaned[field] = rawChanges[field];
      }
    }

    if (Object.keys(cleaned).length === 0) {
      return error(res, {
        statusCode: 400,
        message: `No editable fields provided. Editable fields: ${EDITABLE_PROFILE_FIELDS.join(', ')}`,
      });
    }

    // Validate location_id if the user is trying to change it.
    if (cleaned.location_id) {
      const loc = await Location.findByPk(cleaned.location_id);
      if (!loc || loc.is_sandbox || !['zone', 'address'].includes(loc.type)) {
        return error(res, {
          statusCode: 400,
          message: 'location_id must reference a zone or address location',
        });
      }
    }

    // Block if there's already a pending request from this user.
    const existing = await ProfileEditRequest.findOne({
      where: { user_id: req.actingUserId, status: 'pending' },
    });
    if (existing) {
      return error(res, {
        statusCode: 409,
        message: 'You already have a pending profile edit request',
      });
    }

    const request = await ProfileEditRequest.create({
      user_id: req.actingUserId,
      requested_changes: cleaned,
      status: 'pending',
    });

    return success(res, {
      statusCode: 201,
      message: 'Profile edit request submitted for review',
      data: {
        id: request.id,
        status: request.status,
        requested_changes: request.requested_changes,
        created_at: request.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/users/profile-edit-requests
// Access: admin, super_admin. Admins see only requests from users in their
//         own zone; super_admins see everything.
//
// Query: ?status=pending|approved|rejected  (optional filter)
// ---------------------------------------------------------------------------
const getProfileEditRequests = async (req, res, next) => {
  try {
    const { status } = req.query;
    const { role, zone_location_id } = req.auth;

    const where = {};
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      where.status = status;
    }

    const userWhere = {};
    if (role === 'admin') {
      const ids = await locationIdsInZone(zone_location_id);
      userWhere.location_id = { [Op.in]: ids.length ? ids : [null] };
    }

    const visible = await ProfileEditRequest.findAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'status'],
          where: userWhere,
          required: role === 'admin',
          include: [buildLocationInclude()],
        },
      ],
      order: [['created_at', 'DESC']],
      limit: 500,
    });

    return success(res, {
      statusCode: 200,
      message: 'Profile edit requests fetched',
      data: visible,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/users/profile-edit-requests/:id/review
// Access: super_admin only (approves/rejects, applies changes on approve).
// Body: { decision: 'approved' | 'rejected', admin_note? }
//
// On approve: applies requested_changes atomically to the users row.
// On reject: sets status=rejected, records the note, leaves user untouched.
// Idempotent: refuses to review a request that has already been decided.
// ---------------------------------------------------------------------------
const reviewProfileEditRequest = async (req, res, next) => {
  const t = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { decision, admin_note } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      await t.rollback();
      return error(res, {
        statusCode: 400,
        message: "decision must be 'approved' or 'rejected'",
      });
    }

    const request = await ProfileEditRequest.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!request) {
      await t.rollback();
      return error(res, { statusCode: 404, message: 'Profile edit request not found' });
    }

    if (request.status !== 'pending') {
      await t.rollback();
      return error(res, {
        statusCode: 409,
        message: `This request has already been ${request.status}`,
      });
    }

    // If an approved edit moves the member between zones, BOTH zones' chats
    // need reconciling afterwards — one to drop them, one to pick them up.
    // Collected inside the transaction, acted on after it commits.
    const touchedLocationIds = [];

    if (decision === 'approved') {
      // The request itself is cascade-deleted with the user, so a miss
      // here means a genuinely unexpected state rather than an erasure.
      const user = await User.findByPk(request.user_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!user) {
        await t.rollback();
        return error(res, { statusCode: 404, message: 'User no longer exists' });
      }

      touchedLocationIds.push(user.location_id);

      const changes = request.requested_changes || {};
      // Reapply the allow-list defense here in case someone hand-edits the
      // DB row between submit and review.
      for (const field of EDITABLE_PROFILE_FIELDS) {
        if (changes[field] !== undefined) {
          user[field] = changes[field];
        }
      }
      await user.save({ transaction: t });
      touchedLocationIds.push(user.location_id);
    }

    request.status = decision;
    request.reviewed_by = req.auth.id;
    request.reviewed_at = new Date();
    if (admin_note !== undefined) request.admin_note = admin_note;
    await request.save({ transaction: t });

    await t.commit();

    if (touchedLocationIds.length) {
      const zoneIds = await Promise.all(
        [...new Set(touchedLocationIds)].map((id) => chatGroupSync.zoneForLocation(id))
      );
      chatGroupSync.syncInBackground(zoneIds, 'profile edit approved');
    }

    return success(res, {
      statusCode: 200,
      message: `Profile edit request ${decision}`,
      data: {
        id: request.id,
        status: request.status,
        reviewed_at: request.reviewed_at,
      },
    });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// ---------------------------------------------------------------------------
// Account deletion.
//
// The mechanics live in services/accountDeletionService.js — that file
// documents what happens to every affected table and why. These two
// handlers only translate its result into HTTP.
// ---------------------------------------------------------------------------
const LAST_SUPER_ADMIN_MESSAGE =
  'You are the only active super admin. Promote another super admin first — '
  + 'deleting this account now would leave the community with no administrator.';

const deleteMyAccount = async (req, res, next) => {
  try {
    const result = await eraseUserAccount(req.actingUserId);

    if (result.notFound) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }
    if (result.blocked === 'LAST_SUPER_ADMIN') {
      return error(res, { statusCode: 409, message: LAST_SUPER_ADMIN_MESSAGE });
    }

    return success(res, {
      statusCode: 200,
      message: 'Your account and personal details have been deleted.',
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/users/:id
// Access: super_admin only. Same erasure as self-delete.
// ---------------------------------------------------------------------------
const deleteUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (id === req.auth.id || id === req.auth.user_id) {
      return error(res, {
        statusCode: 400,
        message: 'Use DELETE /api/users/me to delete your own account',
      });
    }

    const result = await eraseUserAccount(id);

    if (result.notFound) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }
    if (result.blocked === 'LAST_SUPER_ADMIN') {
      return error(res, { statusCode: 409, message: LAST_SUPER_ADMIN_MESSAGE });
    }

    return success(res, {
      statusCode: 200,
      message: 'Account deleted.',
      data: { id, removed: result.removed },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/users/me/push-token
// Access: requireUserAccess.
// Body: { token: 'ExponentPushToken[...]' | null }
//
// Registers (or clears) the calling user's Expo push token so the
// backend can send them proximity notifications during delivery.
// Passing null unregisters (e.g. on logout or when permission is
// revoked in the device settings).
// ---------------------------------------------------------------------------
const { isExpoPushToken } = require('../services/expoPushService');

const setPushToken = async (req, res, next) => {
  try {
    const { token } = req.body || {};

    // null → clear. Any other value must match the Expo token pattern.
    if (token !== null && token !== undefined && !isExpoPushToken(token)) {
      return error(res, {
        statusCode: 400,
        message: 'token must be a valid Expo push token (or null to unregister).',
      });
    }

    const user = await User.findByPk(req.actingUserId);
    if (!user) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }

    // One phone, one account. A shared or handed-down device registers the
    // same token under the new account; if the old account still held it,
    // the new user would receive the old user's notifications ("Your Sehri
    // is close", zone broadcasts). Detach it everywhere else first.
    if (token) {
      await User.update(
        { fcm_token: null },
        { where: { fcm_token: token, id: { [Op.ne]: user.id } }, hooks: false }
      );
    }
    user.fcm_token = token || null;
    await user.save({ hooks: false });

    return success(res, {
      statusCode: 200,
      message: token ? 'Push token registered.' : 'Push token cleared.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listUsers,
  updateUserStatus,
  getMe,
  requestProfileEdit,
  getProfileEditRequests,
  reviewProfileEditRequest,
  deleteMyAccount,
  deleteUserById,
  setPushToken,
};
