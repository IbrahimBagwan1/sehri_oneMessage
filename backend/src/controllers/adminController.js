'use strict';
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const {
  buildLocationInclude,
  resolveZoneFromLoaded,
} = require('../utils/zoneScope');
const logger = require('../utils/logger');
const { User, Admin, SuperAdmin, Location } = db;

// ---------------------------------------------------------------------------
// Valid promote-to roles. Extended from here if we ever add rider or other
// promotable roles through this flow.
// ---------------------------------------------------------------------------
const PROMOTABLE_ROLES = ['admin', 'super_admin'];

// ---------------------------------------------------------------------------
// Internal helper — resolves a zone-type location from any location_id.
// Walks up the parent chain until it finds a type='zone' row.
// ---------------------------------------------------------------------------
const resolveZoneLocation = async (locationId) => {
  let current = await Location.findByPk(locationId);
  let hops = 0;
  const MAX_HOPS = 10;
  while (current && current.type !== 'zone' && hops < MAX_HOPS) {
    if (!current.parent_id) return null;
    current = await Location.findByPk(current.parent_id);
    hops += 1;
  }
  return current && current.type === 'zone' ? current : null;
};

// ---------------------------------------------------------------------------
// POST /api/admin/create-admin
// Access: super_admin only
//
// Creates a zone admin. Two modes:
//
//   Mode A — promote an existing user:
//     Pass { user_id, zone_location_id }
//     The admin row is seeded with name/phone from the users table.
//     The existing user's password is reused (no new password needed).
//     user_id is stored on the admin row so the person can switch roles.
//
//   Mode B — create a standalone admin (no user account):
//     Pass { name, phone, password, zone_location_id }
//     No users row is required or created.
//     user_id on the admin row will be null.
//     They can link a user account later by updating user_id.
//
// zone_location_id must reference a location row of type='zone'.
// ---------------------------------------------------------------------------
const createAdmin = async (req, res, next) => {
  try {
    const { user_id, zone_location_id, name, phone, password } = req.body;

    if (!zone_location_id) {
      return error(res, {
        statusCode: 400,
        message: 'zone_location_id is required',
      });
    }

    // Validate zone_location_id points to a zone-type location.
    const zoneLocation = await Location.findByPk(zone_location_id);
    if (!zoneLocation || zoneLocation.type !== 'zone') {
      return error(res, {
        statusCode: 400,
        message: 'zone_location_id must reference a location of type zone',
      });
    }

    let adminName, adminPhone, adminPasswordHash, linkedUserId;

    if (user_id) {
      // --- Mode A: promote an existing user ---
      const user = await User.scope('withPassword').findByPk(user_id);
      if (!user) {
        return error(res, { statusCode: 404, message: 'User not found' });
      }
      if (user.status !== 'approved') {
        return error(res, {
          statusCode: 422,
          message: 'Only approved users can be promoted to admin',
        });
      }

      // Check this user isn't already an admin.
      const existingAdmin = await Admin.findOne({ where: { phone: user.phone } });
      if (existingAdmin) {
        return error(res, {
          statusCode: 409,
          message: 'This user already has an admin account',
        });
      }

      adminName = user.name;
      adminPhone = user.phone;
      adminPasswordHash = user.password; // reuse hashed password — no re-entry needed
      linkedUserId = user.id;
    } else {
      // --- Mode B: standalone admin ---
      if (!name || !phone || !password) {
        return error(res, {
          statusCode: 400,
          message: 'name, phone, and password are required when not promoting a user',
        });
      }

      if (!/^[6-9]\d{9}$/.test(phone)) {
        return error(res, {
          statusCode: 400,
          message: 'Phone must be a valid 10-digit Indian mobile number',
        });
      }

      if (password.length < 6) {
        return error(res, {
          statusCode: 400,
          message: 'Password must be at least 6 characters',
        });
      }

      // Ensure the phone isn't already in the admins table.
      const existingAdmin = await Admin.findOne({ where: { phone } });
      if (existingAdmin) {
        return error(res, {
          statusCode: 409,
          message: 'An admin with this phone number already exists',
        });
      }

      adminName = name;
      adminPhone = phone;
      adminPasswordHash = await bcrypt.hash(password, 10);
      linkedUserId = null;
    }

    const admin = await Admin.create({
      name: adminName,
      phone: adminPhone,
      password: adminPasswordHash,
      zone_location_id,
      user_id: linkedUserId,
    });

    return success(res, {
      statusCode: 201,
      message: 'Admin created successfully',
      data: {
        id: admin.id,
        name: admin.name,
        phone: admin.phone,
        zone_location_id: admin.zone_location_id,
        zone_name: zoneLocation.name,
        user_id: admin.user_id,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/create-super-admin
// Access: super_admin only
//
// Same two-mode approach as createAdmin.
// Super admins have no zone — they oversee everything.
// ---------------------------------------------------------------------------
const createSuperAdmin = async (req, res, next) => {
  try {
    const { user_id, name, phone, password } = req.body;

    let saName, saPhone, saPasswordHash, linkedUserId;

    if (user_id) {
      // --- Mode A: promote an existing user ---
      const user = await User.scope('withPassword').findByPk(user_id);
      if (!user) {
        return error(res, { statusCode: 404, message: 'User not found' });
      }
      if (user.status !== 'approved') {
        return error(res, {
          statusCode: 422,
          message: 'Only approved users can be promoted to super admin',
        });
      }

      const existingSA = await SuperAdmin.findOne({ where: { phone: user.phone } });
      if (existingSA) {
        return error(res, {
          statusCode: 409,
          message: 'This user already has a super admin account',
        });
      }

      saName = user.name;
      saPhone = user.phone;
      saPasswordHash = user.password;
      linkedUserId = user.id;
    } else {
      // --- Mode B: standalone super admin ---
      if (!name || !phone || !password) {
        return error(res, {
          statusCode: 400,
          message: 'name, phone, and password are required when not promoting a user',
        });
      }

      if (!/^[6-9]\d{9}$/.test(phone)) {
        return error(res, {
          statusCode: 400,
          message: 'Phone must be a valid 10-digit Indian mobile number',
        });
      }

      if (password.length < 6) {
        return error(res, {
          statusCode: 400,
          message: 'Password must be at least 6 characters',
        });
      }

      const existingSA = await SuperAdmin.findOne({ where: { phone } });
      if (existingSA) {
        return error(res, {
          statusCode: 409,
          message: 'A super admin with this phone number already exists',
        });
      }

      saName = name;
      saPhone = phone;
      saPasswordHash = await bcrypt.hash(password, 10);
      linkedUserId = null;
    }

    const superAdmin = await SuperAdmin.create({
      name: saName,
      phone: saPhone,
      password: saPasswordHash,
      user_id: linkedUserId,
    });

    return success(res, {
      statusCode: 201,
      message: 'Super admin created successfully',
      data: {
        id: superAdmin.id,
        name: superAdmin.name,
        phone: superAdmin.phone,
        user_id: superAdmin.user_id,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/admin/list-admins
// Access: super_admin only
//
// Returns all zone admins with their zone name and whether they have a
// linked user account.
// ---------------------------------------------------------------------------
const listAdmins = async (req, res, next) => {
  try {
    const admins = await Admin.findAll({
      include: [
        {
          model: Location,
          as: 'zone',
          attributes: ['id', 'name'],
        },
      ],
      order: [['created_at', 'ASC']],
    });

    return success(res, {
      statusCode: 200,
      message: 'Admins fetched successfully',
      data: admins.map((a) => ({
        id: a.id,
        name: a.name,
        phone: a.phone,
        zone: a.zone ? { id: a.zone.id, name: a.zone.name } : null,
        user_id: a.user_id,
        is_active: a.is_active,
        created_at: a.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/admin/admins/:id
// Access: super_admin only
//
// Removes the admin row. Does NOT delete the linked users row — the person
// remains a regular user if they had one.
// ---------------------------------------------------------------------------
const deleteAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const admin = await Admin.findByPk(id);
    if (!admin) {
      return error(res, { statusCode: 404, message: 'Admin not found' });
    }

    await admin.destroy();

    return success(res, {
      statusCode: 200,
      message: 'Admin removed successfully',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/admin/admins/:id/link-user
// Access: super_admin only
//
// Links (or unlinks) an existing users row to an admin account.
// Useful for backfilling user_id on admins created before this feature
// existed, without recreating the admin account.
//
// Body: { user_id: "<uuid>" }  — to link
//       { user_id: null }      — to unlink
// ---------------------------------------------------------------------------
const linkUserToAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    const admin = await Admin.findByPk(id);
    if (!admin) {
      return error(res, { statusCode: 404, message: 'Admin not found' });
    }

    if (user_id !== null && user_id !== undefined) {
      const user = await User.findByPk(user_id);
      if (!user) {
        return error(res, { statusCode: 404, message: 'User not found' });
      }
      // Make sure no other admin is already linked to this user.
      const conflict = await Admin.findOne({
        where: { user_id, id: { [Op.ne]: id } },
      });
      if (conflict) {
        return error(res, {
          statusCode: 409,
          message: 'This user is already linked to another admin account',
        });
      }
    }

    admin.user_id = user_id ?? null;
    await admin.save();

    return success(res, {
      statusCode: 200,
      message: user_id ? 'User linked to admin successfully' : 'User unlinked from admin',
      data: { id: admin.id, user_id: admin.user_id },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/admin/users/search?q=<name-or-phone>&page=&limit=
// Access: super_admin only
//
// Free-text search across the users table by NAME (case-insensitive
// substring) or PHONE (substring; non-digit characters in the query
// are stripped so "+91 96327 16392" and "9632716392" both match).
//
// Standard pagination envelope (page/limit/total). Soft-deleted rows
// are excluded. Each row includes `existing_roles` so the frontend can
// decide whether promoting to admin/super_admin is still available.
// ---------------------------------------------------------------------------
const searchUsers = async (req, res, next) => {
  try {
    const rawQ = (req.query.q || '').toString().trim();
    if (!rawQ || rawQ.length < 2) {
      return error(res, {
        statusCode: 400,
        message: 'Type at least 2 characters to search (name or phone digits).',
      });
    }

    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // Case-insensitive substring on name; digits-only substring on phone.
    const digits = rawQ.replace(/\D/g, '');
    const nameLike = { [Op.like]: `%${rawQ.toLowerCase()}%` };
    const orClauses = [
      // MySQL is case-insensitive on VARCHAR by default (utf8mb4 CI collation).
      // sequelize.where + fn LOWER would be safer on other engines, but this
      // codebase is MySQL-only per config/database.js.
      { name:  nameLike },
    ];
    if (digits.length >= 3) {
      orClauses.push({ phone: { [Op.like]: `%${digits}%` } });
    }

    const { count, rows } = await User.findAndCountAll({
      where: {
        status: { [Op.ne]: 'deleted' },
        [Op.or]: orClauses,
      },
      include: [buildLocationInclude()],
      order: [['name', 'ASC']],
      limit,
      offset,
    });

    // Enrich with the roles this phone/user already holds so the UI
    // can gray out disallowed promotions.
    const userIds  = rows.map((u) => u.id);
    const phones   = rows.map((u) => u.phone);
    const [linkedAdmins, linkedSuperAdmins, phoneAdmins, phoneSuperAdmins] =
      userIds.length === 0 ? [[], [], [], []] : await Promise.all([
        Admin.findAll({      where: { user_id: userIds }, attributes: ['user_id'] }),
        SuperAdmin.findAll({ where: { user_id: userIds }, attributes: ['user_id'] }),
        Admin.findAll({      where: { phone:   phones  }, attributes: ['phone'] }),
        SuperAdmin.findAll({ where: { phone:   phones  }, attributes: ['phone'] }),
      ]);
    const adminUserIds       = new Set(linkedAdmins.map((r) => r.user_id));
    const superAdminUserIds  = new Set(linkedSuperAdmins.map((r) => r.user_id));
    const adminPhones        = new Set(phoneAdmins.map((r) => r.phone));
    const superAdminPhones   = new Set(phoneSuperAdmins.map((r) => r.phone));

    const users = rows.map((u) => {
      const zone = resolveZoneFromLoaded(u.location);
      const existing_roles = ['user'];
      if (adminUserIds.has(u.id)      || adminPhones.has(u.phone))      existing_roles.push('admin');
      if (superAdminUserIds.has(u.id) || superAdminPhones.has(u.phone)) existing_roles.push('super_admin');
      return {
        id:         u.id,
        name:       u.name,
        phone:      u.phone,
        status:     u.status,
        gender:     u.gender,
        occupation: u.occupation,
        city:       u.city,
        address:    u.address,
        zone: zone ? { id: zone.id, name: zone.name } : null,
        existing_roles,
        created_at: u.createdAt,
      };
    });

    return success(res, {
      statusCode: 200,
      message: 'Users fetched',
      data: { total: count, page, limit, users },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/promote
// Access: super_admin only
// Body: { target_role: 'admin' | 'super_admin', zone_location_id?: uuid }
//
// Promotes an existing approved user to admin or super_admin. Follows
// the "Mode A" pattern used by createAdmin/createSuperAdmin — reuses
// the user's existing bcrypt password hash, and links via user_id so
// the promoted person can switch roles from a single sign-in.
//
// Guarantees:
//   • Only super_admin may call. Regular admins can't promote anyone.
//   • The user must exist, be status='approved', and not already hold
//     the target role or a higher one (super_admin > admin > user).
//   • Promoting to admin requires zone_location_id → validated as
//     type='zone' (admin.zone_location_id is NOT NULL in the schema).
//   • Records who ran the promotion (promoted_by = req.auth.id) and
//     when (promoted_at). Kept in the new admin/super_admin row.
// ---------------------------------------------------------------------------
const promoteUser = async (req, res, next) => {
  const t = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { target_role, zone_location_id } = req.body || {};

    if (!PROMOTABLE_ROLES.includes(target_role)) {
      await t.rollback();
      return error(res, {
        statusCode: 400,
        message: `target_role must be one of: ${PROMOTABLE_ROLES.join(', ')}`,
      });
    }

    // Load the target user.
    const user = await User.scope('withPassword').findByPk(id, { transaction: t });
    if (!user) {
      await t.rollback();
      return error(res, { statusCode: 404, message: 'User not found' });
    }
    if (user.status !== 'approved') {
      await t.rollback();
      return error(res, {
        statusCode: 422,
        message: `Only approved users can be promoted. This user's status is "${user.status}".`,
      });
    }

    // Check existing roles for this person (by user_id AND by phone —
    // legacy standalone admin rows may not have user_id set).
    const [existingAdmin, existingSuperAdmin] = await Promise.all([
      Admin.findOne({
        where: { [Op.or]: [{ user_id: user.id }, { phone: user.phone }] },
        transaction: t,
      }),
      SuperAdmin.findOne({
        where: { [Op.or]: [{ user_id: user.id }, { phone: user.phone }] },
        transaction: t,
      }),
    ]);

    if (existingSuperAdmin) {
      await t.rollback();
      return error(res, {
        statusCode: 409,
        message: `${user.name} is already a super admin — that's the highest role.`,
      });
    }
    if (target_role === 'admin' && existingAdmin) {
      await t.rollback();
      return error(res, {
        statusCode: 409,
        message: `${user.name} is already an admin.`,
      });
    }

    // Additional validation per target role.
    let zoneLocation = null;
    if (target_role === 'admin') {
      if (!zone_location_id) {
        await t.rollback();
        return error(res, {
          statusCode: 400,
          message: 'zone_location_id is required when promoting to admin.',
        });
      }
      zoneLocation = await Location.findByPk(zone_location_id, { transaction: t });
      if (!zoneLocation || zoneLocation.type !== 'zone') {
        await t.rollback();
        return error(res, {
          statusCode: 400,
          message: 'zone_location_id must reference a location of type zone.',
        });
      }
    }

    // Now perform the promotion. Reuse the user's existing bcrypt hash
    // so they sign in with the same password — same pattern as
    // createAdmin/createSuperAdmin Mode A.
    const now = new Date();
    const auditFields = {
      promoted_by: req.auth.id,
      promoted_at: now,
    };

    if (target_role === 'admin') {
      const admin = await Admin.create({
        name:             user.name,
        phone:            user.phone,
        password:         user.password,        // already hashed
        zone_location_id: zone_location_id,
        user_id:          user.id,
        ...auditFields,
      }, { transaction: t });

      await t.commit();
      logger.info(`[admin] Promoted user ${user.id} to admin (zone=${zoneLocation.name}) by super_admin ${req.auth.id}`);
      return success(res, {
        statusCode: 201,
        message: `${user.name} is now an admin for ${zoneLocation.name}.`,
        data: {
          id:               admin.id,
          role:             'admin',
          name:             admin.name,
          phone:            admin.phone,
          zone_location_id: admin.zone_location_id,
          zone_name:        zoneLocation.name,
          user_id:          admin.user_id,
          promoted_by:      admin.promoted_by,
          promoted_at:      admin.promoted_at,
        },
      });
    }

    // target_role === 'super_admin'
    const sa = await SuperAdmin.create({
      name:     user.name,
      phone:    user.phone,
      password: user.password,                  // already hashed
      user_id:  user.id,
      ...auditFields,
    }, { transaction: t });

    await t.commit();
    logger.info(`[admin] Promoted user ${user.id} to super_admin by super_admin ${req.auth.id}`);
    return success(res, {
      statusCode: 201,
      message: `${user.name} is now a super admin.`,
      data: {
        id:          sa.id,
        role:        'super_admin',
        name:        sa.name,
        phone:       sa.phone,
        user_id:     sa.user_id,
        promoted_by: sa.promoted_by,
        promoted_at: sa.promoted_at,
      },
    });
  } catch (err) {
    try { await t.rollback(); } catch (_) { /* noop */ }
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/admin/link-user-account
// Access: admin OR super_admin
// Body: { location_id, address?, gender?, occupation? }
//
// Self-service: creates a User row for the calling admin/super_admin and
// links it via user_id. Reuses their existing bcrypt hash (same password),
// marks the user 'approved' (they're already privileged).
//
// Why this exists: an admin/super_admin created in "standalone" mode
// (POST /create-admin without user_id) has no linked user account, so
// their login response returns available_roles=[<their role>] only, and
// the role-switch chips on the dashboard stay hidden — they have
// nowhere to switch to. This endpoint fills that gap without needing
// another super_admin to run a promotion.
// ---------------------------------------------------------------------------
const linkUserAccount = async (req, res, next) => {
  const t = await db.sequelize.transaction();
  try {
    const { location_id, address, gender, occupation } = req.body || {};
    const { id: callerId, role: callerRole } = req.auth;

    if (!location_id) {
      await t.rollback();
      return error(res, { statusCode: 400, message: 'location_id is required.' });
    }

    const loc = await Location.findByPk(location_id, { transaction: t });
    if (!loc || !['zone', 'address'].includes(loc.type)) {
      await t.rollback();
      return error(res, {
        statusCode: 400,
        message: 'location_id must reference a zone or address location.',
      });
    }

    const CallerModel = callerRole === 'super_admin' ? SuperAdmin : Admin;
    const caller = await CallerModel.scope('withPassword').findByPk(callerId, { transaction: t });
    if (!caller) {
      await t.rollback();
      return error(res, { statusCode: 404, message: 'Account not found.' });
    }

    if (caller.user_id) {
      await t.rollback();
      return error(res, {
        statusCode: 409,
        message: 'You already have a linked user account. Sign out and back in to refresh your roles.',
      });
    }

    // If a users row already exists for this phone (registered separately),
    // just LINK to it rather than creating a duplicate — phone is unique.
    const existingUser = await User.findOne({ where: { phone: caller.phone }, transaction: t });

    let userRow;
    let linkKind;
    if (existingUser) {
      userRow  = existingUser;
      linkKind = 'existing';
    } else {
      userRow = await User.create({
        name:              caller.name,
        phone:             caller.phone,
        password:          caller.password,        // already hashed
        gender:            gender     || 'male',
        occupation:        occupation || 'others',
        city:              'Bangalore',
        location_id,
        address:           (address && address.trim()) || 'Admin account — no residential address',
        status:            'approved',
        is_phone_verified: true,
      }, { transaction: t });
      linkKind = 'created';
    }

    await caller.update({ user_id: userRow.id }, { transaction: t });
    await t.commit();

    // Derive the fresh role list so the client can update its store
    // without a re-login. Kept inline (no import from authController) to
    // avoid a circular dependency between the two controllers.
    const [saRow, adminRow] = await Promise.all([
      SuperAdmin.findOne({ where: { phone: caller.phone } }),
      Admin.findOne({      where: { phone: caller.phone } }),
    ]);
    const available_roles = ['user'];
    if (adminRow) available_roles.push('admin');
    if (saRow)    available_roles.push('super_admin');

    logger.info(`[admin] ${callerRole} ${callerId} ${linkKind} linked user account ${userRow.id}`);
    return success(res, {
      statusCode: linkKind === 'created' ? 201 : 200,
      message: linkKind === 'created'
        ? 'User account created and linked. Role switching is now available.'
        : 'Existing user account linked. Role switching is now available.',
      data: {
        user_id:         userRow.id,
        linked:          linkKind,
        available_roles,
      },
    });
  } catch (err) {
    try { await t.rollback(); } catch (_) { /* noop */ }
    next(err);
  }
};

module.exports = {
  createAdmin,
  createSuperAdmin,
  listAdmins,
  deleteAdmin,
  linkUserToAdmin,
  searchUsers,
  promoteUser,
  linkUserAccount,
};
