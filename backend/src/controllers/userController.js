'use strict';

const db = require('../models');
const { success, error } = require('../utils/response');
const { buildLocationInclude, resolveZoneFromLoaded } = require('../utils/zoneScope');
const { eraseUserAccount } = require('../services/accountDeletionService');

const { User, Location, ProfileEditRequest } = db;

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
    if (status) where.status = status;

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
      // The request itself is cascade-deleted with the user, so a miss
      // here means a genuinely unexpected state rather than an erasure.
      const user = await User.findByPk(request.user_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!user) {
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
