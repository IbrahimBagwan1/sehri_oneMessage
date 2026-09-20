'use strict';
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { User, Admin, SuperAdmin, Location } = db;

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

module.exports = {
  createAdmin,
  createSuperAdmin,
  listAdmins,
  deleteAdmin,
  linkUserToAdmin,
};
