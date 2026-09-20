'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { buildLocationInclude, resolveZoneFromLoaded } = require('../utils/zoneScope');
const logger = require('../utils/logger');

const { User, Location, ProfileEditRequest, Admin, SuperAdmin, Rider } = db;

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

    const where = {};
    if (status) {
      where.status = status;
    } else {
      // Never surface soft-deleted rows in the default list.
      where.status = { [Op.ne]: 'deleted' };
    }

    const users = await User.findAll({
      where,
      include: [buildLocationInclude()],
      order: [['createdAt', 'DESC']],
    });

    if (role === 'super_admin') {
      return success(res, {
        statusCode: 200,
        message: 'Users fetched successfully',
        data: users,
      });
    }

    // role === 'admin' → keep only users whose resolved zone matches.
    const filtered = users.filter((user) => {
      const zone = resolveZoneFromLoaded(user.location);
      return zone && zone.id === zone_location_id;
    });

    return success(res, {
      statusCode: 200,
      message: 'Users fetched successfully',
      data: filtered,
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
// anyone. Refuses to touch soft-deleted rows.
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

    if (!user || user.status === 'deleted') {
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

    if (!user || user.status === 'deleted') {
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
      if (!loc || !['zone', 'address'].includes(loc.type)) {
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

    const requests = await ProfileEditRequest.findAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'status'],
          include: [buildLocationInclude()],
        },
      ],
      order: [['created_at', 'DESC']],
    });

    let visible = requests;
    if (role === 'admin') {
      visible = requests.filter((r) => {
        const zone = resolveZoneFromLoaded(r.user?.location);
        return zone && zone.id === zone_location_id;
      });
    }

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

    if (decision === 'approved') {
      const user = await User.findByPk(request.user_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!user || user.status === 'deleted') {
        await t.rollback();
        return error(res, { statusCode: 404, message: 'User no longer exists' });
      }

      const changes = request.requested_changes || {};
      // Reapply the allow-list defense here in case someone hand-edits the
      // DB row between submit and review.
      for (const field of EDITABLE_PROFILE_FIELDS) {
        if (changes[field] !== undefined) {
          user[field] = changes[field];
        }
      }
      await user.save({ transaction: t });
    }

    request.status = decision;
    request.reviewed_by = req.auth.id;
    request.reviewed_at = new Date();
    if (admin_note !== undefined) request.admin_note = admin_note;
    await request.save({ transaction: t });

    await t.commit();

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
// Shared account soft-delete + PII anonymization.
//
// Referential integrity is preserved (poll_responses, donations, feedback,
// chat messages all keep the FK). Personal data is scrubbed so a deleted
// account cannot be re-identified. Any linked admin / super_admin / rider
// rows are also unlinked and deactivated so the deleted person can't log
// back in through a parallel role.
// ---------------------------------------------------------------------------
const softDeleteUser = async (userId) => {
  const t = await db.sequelize.transaction();
  try {
    const user = await User.scope('withPassword').findByPk(userId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!user) {
      await t.rollback();
      return { notFound: true };
    }
    if (user.status === 'deleted') {
      await t.rollback();
      return { alreadyDeleted: true };
    }

    // The phone column has a UNIQUE index, so the placeholder must also be
    // unique. Prefix with DEL- and stamp the id + a timestamp.
    const anonymizedPhone = `DEL-${user.id.slice(0, 8)}-${Date.now()}`.slice(0, 15);

    user.name = 'Deleted User';
    user.phone = anonymizedPhone;
    user.address = 'DELETED';
    user.fcm_token = null;
    user.profile_picture = null;
    user.status = 'deleted';
    // Overwrite the password so no leaked hash is ever useful.
    user.password = await bcrypt.hash(`deleted-${user.id}-${Date.now()}`, 10);

    // Skip model validators + hooks: the anonymized values are intentionally
    // shaped to break the "valid Indian mobile / real user" invariants
    // those validators enforce. Without this, `user.save()` throws a
    // Sequelize ValidationError on the phone regex and the delete silently
    // fails with a generic 500.
    await user.save({ transaction: t, validate: false, hooks: false });

    // Deactivate any linked privileged accounts so the person cannot log
    // back in via admin/super_admin/rider role.
    await Admin.update(
      { user_id: null, is_active: false },
      { where: { user_id: userId }, transaction: t }
    );
    await SuperAdmin.update(
      { user_id: null, is_active: false },
      { where: { user_id: userId }, transaction: t }
    );
    if (Rider) {
      await Rider.update(
        { user_id: null, is_active: false },
        { where: { user_id: userId }, transaction: t }
      );
    }

    await t.commit();
    logger.info(`[users] Account soft-deleted and anonymized: ${userId} (phone→${anonymizedPhone})`);
    return { deleted: true };
  } catch (err) {
    // Best-effort rollback; ignore double-rollback errors if the txn
    // was already released (e.g. connection reset mid-save).
    try { await t.rollback(); } catch (_) { /* noop */ }
    logger.error(`[users] softDeleteUser(${userId}) failed: ${err.name}: ${err.message}`);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/users/me
// Access: any authenticated user (via requireUserAccess).
//
// Anonymizes the calling user's own account. Poll history, donations, chat
// messages remain (with the anonymized display name) so aggregate stats
// and audit trails stay consistent.
// ---------------------------------------------------------------------------
const deleteMyAccount = async (req, res, next) => {
  try {
    const result = await softDeleteUser(req.actingUserId);

    if (result.notFound) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }
    if (result.alreadyDeleted) {
      return error(res, { statusCode: 410, message: 'This account is already deleted' });
    }

    return success(res, {
      statusCode: 200,
      message: 'Account deleted. You have been logged out.',
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/users/:id
// Access: super_admin only.
//
// Admin-initiated soft delete. Same anonymization as self-delete.
// ---------------------------------------------------------------------------
const deleteUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (id === req.auth.id) {
      return error(res, {
        statusCode: 400,
        message: 'Use DELETE /api/users/me to delete your own account',
      });
    }

    const result = await softDeleteUser(id);

    if (result.notFound) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }
    if (result.alreadyDeleted) {
      return error(res, { statusCode: 410, message: 'This account is already deleted' });
    }

    return success(res, {
      statusCode: 200,
      message: 'User account deleted and anonymized',
      data: { id },
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
    if (!user || user.status === 'deleted') {
      return error(res, { statusCode: 404, message: 'User not found' });
    }

    user.fcm_token = token || null;
    // Anonymized rows fail phone validation, so we save without validators.
    // For a normal token save, `validate: true` is fine — the anonymization
    // path is inside softDeleteUser, not here.
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
