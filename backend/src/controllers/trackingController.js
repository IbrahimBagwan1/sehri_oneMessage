'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const { resolveZone } = require('../utils/resolveZone');

const { Rider, Poll, PollResponse, User, Location } = db;

// ---------------------------------------------------------------------------
// Internal helper — fetch today's poll (same pattern as pollController).
// ---------------------------------------------------------------------------
const getTodaysPoll = async () => {
  const istDateStr = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  return Poll.findOne({ where: { date: istDateStr } });
};

// ---------------------------------------------------------------------------
// POST /api/tracking/rider-login
// Access: Public
//
// Rider logs in with phone + password.
// Issues a JWT with role: 'rider' — same infrastructure as user/admin login.
// If the rider has a linked user_id, it is carried in the token so they can
// access user-scoped routes (voting, prayer times, chat) without re-logging in.
// ---------------------------------------------------------------------------
const riderLogin = async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return error(res, {
        statusCode: 400,
        message: 'Phone and password are required',
      });
    }

    const rider = await Rider.scope('withPassword').findOne({ where: { phone } });

    if (!rider) {
      return error(res, { statusCode: 401, message: 'Invalid phone or password' });
    }

    if (!rider.is_active) {
      return error(res, {
        statusCode: 403,
        message: 'Your rider account has been deactivated',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, rider.password);
    if (!isPasswordValid) {
      return error(res, { statusCode: 401, message: 'Invalid phone or password' });
    }

    // Build token payload — same shape as admin/super_admin but with role 'rider'.
    const payload = { id: rider.id, role: 'rider' };
    if (rider.zone_location_id) payload.zone_location_id = rider.zone_location_id;
    if (rider.user_id) payload.user_id = rider.user_id;

    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    return success(res, {
      statusCode: 200,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        active_role: 'rider',
        profile: {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          zone_location_id: rider.zone_location_id,
          user_id: rider.user_id,
          status: rider.status,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/tracking
// Access: super_admin
//
// Creates a new rider. Two modes — same pattern as createAdmin:
//
//   Mode A — promote an existing user: pass { user_id, zone_location_id, password }
//     Seeds name/phone from the users row. user_id is stored for JWT linking.
//     A separate password is required because the rider uses a different login.
//
//   Mode B — standalone rider: pass { name, phone, password, zone_location_id }
//     No users row required. user_id will be null.
//
// zone_location_id is optional (null = serves all zones).
// ---------------------------------------------------------------------------
const createRider = async (req, res, next) => {
  try {
    const { user_id, zone_location_id, name, phone, password } = req.body;

    if (!password || password.length < 6) {
      return error(res, {
        statusCode: 400,
        message: 'Password is required and must be at least 6 characters',
      });
    }

    // Validate zone if provided
    let zoneLocation = null;
    if (zone_location_id) {
      zoneLocation = await Location.findByPk(zone_location_id);
      if (!zoneLocation || zoneLocation.type !== 'zone') {
        return error(res, {
          statusCode: 400,
          message: 'zone_location_id must reference a location of type zone',
        });
      }
    }

    let riderName, riderPhone, linkedUserId;

    if (user_id) {
      // --- Mode A: promote an existing user ---
      const user = await User.findByPk(user_id, { attributes: ['id', 'name', 'phone', 'status'] });
      if (!user) {
        return error(res, { statusCode: 404, message: 'User not found' });
      }
      if (user.status !== 'approved') {
        return error(res, {
          statusCode: 422,
          message: 'Only approved users can be made riders',
        });
      }

      const existingRider = await Rider.findOne({ where: { phone: user.phone } });
      if (existingRider) {
        return error(res, {
          statusCode: 409,
          message: 'This user already has a rider account',
        });
      }

      riderName = user.name;
      riderPhone = user.phone;
      linkedUserId = user.id;
    } else {
      // --- Mode B: standalone rider ---
      if (!name || !phone) {
        return error(res, {
          statusCode: 400,
          message: 'name and phone are required when not linking to an existing user',
        });
      }

      if (!/^[6-9]\d{9}$/.test(phone)) {
        return error(res, {
          statusCode: 400,
          message: 'Phone must be a valid 10-digit Indian mobile number',
        });
      }

      const existingRider = await Rider.findOne({ where: { phone } });
      if (existingRider) {
        return error(res, {
          statusCode: 409,
          message: 'A rider with this phone number already exists',
        });
      }

      riderName = name;
      riderPhone = phone;
      linkedUserId = null;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const rider = await Rider.create({
      name: riderName,
      phone: riderPhone,
      password: hashedPassword,
      zone_location_id: zone_location_id || null,
      user_id: linkedUserId,
    });

    return success(res, {
      statusCode: 201,
      message: 'Rider created successfully',
      data: {
        id: rider.id,
        name: rider.name,
        phone: rider.phone,
        zone_location_id: rider.zone_location_id,
        zone_name: zoneLocation ? zoneLocation.name : null,
        user_id: rider.user_id,
        status: rider.status,
        is_active: rider.is_active,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/tracking/all
// Access: super_admin
//
// Returns all riders with their zone name. Used by the admin management screen.
// ---------------------------------------------------------------------------
const getAllRiders = async (req, res, next) => {
  try {
    const riders = await Rider.findAll({
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
      message: 'Riders fetched successfully',
      data: riders.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        zone: r.zone ? { id: r.zone.id, name: r.zone.name } : null,
        user_id: r.user_id,
        status: r.status,
        is_active: r.is_active,
        latitude: r.latitude,
        longitude: r.longitude,
        current_address: r.current_address,
        eta_minutes: r.eta_minutes,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/tracking/:id/assign-today
// Access: super_admin
//
// Assigns a rider to today's poll.
// Only active riders can be assigned.
// Replaces any existing assignment — only one rider per day.
// ---------------------------------------------------------------------------
const assignTodaysRider = async (req, res, next) => {
  try {
    const { id } = req.params;

    const rider = await Rider.findByPk(id, {
      include: [{ model: Location, as: 'zone', attributes: ['id', 'name'] }],
    });

    if (!rider) {
      return error(res, { statusCode: 404, message: 'Rider not found' });
    }

    if (!rider.is_active) {
      return error(res, {
        statusCode: 422,
        message: 'Cannot assign an inactive rider. Enable the rider first.',
      });
    }

    const poll = await getTodaysPoll();
    if (!poll) {
      return error(res, {
        statusCode: 404,
        message: 'No poll found for today. The poll must exist before assigning a rider.',
      });
    }

    poll.assigned_rider_id = rider.id;
    await poll.save();

    return success(res, {
      statusCode: 200,
      message: `${rider.name} assigned as today's rider`,
      data: {
        poll_id: poll.id,
        poll_date: poll.date,
        rider: {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          zone: rider.zone ? { id: rider.zone.id, name: rider.zone.name } : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/tracking/:id/toggle
// Access: super_admin
//
// Flips the rider's is_active flag (on-duty / off-duty).
// If the rider is currently assigned to today's poll and is being deactivated,
// the assignment is cleared so residents don't see a "no-show" on the map.
// ---------------------------------------------------------------------------
const toggleRider = async (req, res, next) => {
  try {
    const { id } = req.params;

    const rider = await Rider.findByPk(id);
    if (!rider) {
      return error(res, { statusCode: 404, message: 'Rider not found' });
    }

    rider.is_active = !rider.is_active;
    await rider.save();

    // If the rider was just deactivated, clear today's assignment if it's them.
    if (!rider.is_active) {
      const poll = await getTodaysPoll();
      if (poll && poll.assigned_rider_id === rider.id) {
        poll.assigned_rider_id = null;
        await poll.save();
      }
    }

    return success(res, {
      statusCode: 200,
      message: `Rider ${rider.is_active ? 'activated' : 'deactivated'} successfully`,
      data: { id: rider.id, name: rider.name, is_active: rider.is_active },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/tracking/:id/location
// Access: super_admin
// Body: { latitude, longitude, current_address?, eta_minutes? }
//
// Manual override of a rider's location — for edge cases where GPS fails.
// ---------------------------------------------------------------------------
const updateLocationManual = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { latitude, longitude, current_address, eta_minutes } = req.body;

    if (latitude == null || longitude == null) {
      return error(res, {
        statusCode: 400,
        message: 'latitude and longitude are required',
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      return error(res, { statusCode: 400, message: 'latitude must be between -90 and 90' });
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      return error(res, { statusCode: 400, message: 'longitude must be between -180 and 180' });
    }

    const rider = await Rider.findByPk(id);
    if (!rider) {
      return error(res, { statusCode: 404, message: 'Rider not found' });
    }

    rider.latitude = lat;
    rider.longitude = lng;
    if (current_address !== undefined) rider.current_address = current_address;
    if (eta_minutes !== undefined) rider.eta_minutes = parseInt(eta_minutes) || null;

    await rider.save();

    return success(res, {
      statusCode: 200,
      message: 'Rider location updated',
      data: {
        id: rider.id,
        latitude: rider.latitude,
        longitude: rider.longitude,
        current_address: rider.current_address,
        eta_minutes: rider.eta_minutes,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/tracking/:id/push-location
// Access: rider (own record only)
// Body: { latitude, longitude, current_address?, eta_minutes?, status? }
//
// Hot path — called by the rider app every 5 seconds while delivering.
// Only the rider themselves can push to their own record.
// ---------------------------------------------------------------------------
const pushLocation = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Riders can only update their own location.
    if (req.auth.id !== id) {
      return error(res, {
        statusCode: 403,
        message: 'You can only update your own location',
      });
    }

    const { latitude, longitude, current_address, eta_minutes, status } = req.body;

    if (latitude == null || longitude == null) {
      return error(res, {
        statusCode: 400,
        message: 'latitude and longitude are required',
      });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || lat < -90 || lat > 90) {
      return error(res, { statusCode: 400, message: 'latitude must be between -90 and 90' });
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      return error(res, { statusCode: 400, message: 'longitude must be between -180 and 180' });
    }

    if (status && !['idle', 'delivering', 'done'].includes(status)) {
      return error(res, {
        statusCode: 400,
        message: "status must be one of: 'idle', 'delivering', 'done'",
      });
    }

    const rider = await Rider.findByPk(id);
    if (!rider) {
      return error(res, { statusCode: 404, message: 'Rider not found' });
    }

    if (!rider.is_active) {
      return error(res, {
        statusCode: 403,
        message: 'Your account is currently deactivated',
      });
    }

    rider.latitude = lat;
    rider.longitude = lng;
    if (current_address !== undefined) rider.current_address = current_address;
    if (eta_minutes !== undefined) rider.eta_minutes = parseInt(eta_minutes) || null;
    if (status) rider.status = status;

    await rider.save();

    return success(res, {
      statusCode: 200,
      message: 'Location updated',
      data: {
        id: rider.id,
        latitude: rider.latitude,
        longitude: rider.longitude,
        current_address: rider.current_address,
        eta_minutes: rider.eta_minutes,
        status: rider.status,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/tracking/active
// Access: requireUserAccess (user, admin/super_admin with linked user)
//
// Returns today's assigned rider if they are active and delivering (or idle).
// Residents use this to show the live map. If no rider is assigned or they
// are done/inactive, returns null so the app shows an appropriate empty state.
//
// Zone filtering: the rider's zone is matched against the calling user's zone.
// If the rider has no zone (serves all), they are visible to everyone.
// ---------------------------------------------------------------------------
const getActiveRider = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();

    if (!poll || !poll.assigned_rider_id) {
      return success(res, {
        statusCode: 200,
        message: 'No rider assigned for today',
        data: { rider: null },
      });
    }

    const rider = await Rider.findByPk(poll.assigned_rider_id, {
      include: [{ model: Location, as: 'zone', attributes: ['id', 'name'] }],
      attributes: [
        'id', 'name', 'phone', 'zone_location_id',
        'latitude', 'longitude', 'current_address',
        'eta_minutes', 'status', 'is_active',
      ],
    });

    if (!rider || !rider.is_active || rider.status === 'done') {
      return success(res, {
        statusCode: 200,
        message: rider?.status === 'done' ? 'Delivery is complete for today' : 'No active rider',
        data: { rider: null },
      });
    }

    // Zone check: if the rider serves a specific zone, only users in that
    // zone should see them. Riders with no zone are visible to all.
    if (rider.zone_location_id) {
      const user = await User.findByPk(req.actingUserId, {
        attributes: ['location_id'],
      });

      if (user) {
        const userZone = await resolveZone(user.location_id, db);
        if (userZone && userZone.id !== rider.zone_location_id) {
          return success(res, {
            statusCode: 200,
            message: 'No rider assigned to your zone',
            data: { rider: null },
          });
        }
      }
    }

    return success(res, {
      statusCode: 200,
      message: 'Active rider fetched',
      data: {
        rider: {
          id: rider.id,
          name: rider.name,
          latitude: rider.latitude,
          longitude: rider.longitude,
          current_address: rider.current_address,
          eta_minutes: rider.eta_minutes,
          status: rider.status,
          zone: rider.zone ? { id: rider.zone.id, name: rider.zone.name } : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/tracking/delivery-list
// Access: rider (must be today's assigned rider)
//
// Returns today's confirmed delivery list — all users who should receive food.
// This includes:
//   - Regular yes votes (response = 'yes', is_special_case = false)
//   - Special cases approved by super admin (sehri_allowed = 'approved')
// Users who originally voted yes but raised a 'dont_want' special case that
// was approved are excluded.
//
// Results are sorted by address for easier sequential delivery.
// ---------------------------------------------------------------------------
const getDeliveryList = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();

    if (!poll) {
      return error(res, { statusCode: 404, message: 'No poll found for today' });
    }

    // Verify the requesting rider is today's assigned rider.
    if (poll.assigned_rider_id !== req.auth.id) {
      return error(res, {
        statusCode: 403,
        message: 'You are not assigned as today\'s delivery rider',
      });
    }

    // Fetch all yes-voters, excluding dont_want approved special cases.
    // A response is deliverable if:
    //   (response = 'yes' AND NOT (is_special_case = true AND special_case_type = 'dont_want' AND sehri_allowed = 'approved'))
    //   OR
    //   (is_special_case = true AND special_case_type = 'want' AND sehri_allowed = 'approved')
    const responses = await PollResponse.findAll({
      where: {
        poll_id: poll.id,
        [Op.or]: [
          // Regular yes vote that wasn't cancelled via special case
          {
            response: 'yes',
            [Op.not]: {
              is_special_case: true,
              special_case_type: 'dont_want',
              sehri_allowed: 'approved',
            },
          },
          // Special case opt-in approved by super admin
          {
            is_special_case: true,
            special_case_type: 'want',
            sehri_allowed: 'approved',
          },
        ],
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'address', 'location_id'],
        },
      ],
      attributes: ['id', 'zone', 'is_special_case', 'special_case_type'],
      order: [[{ model: User, as: 'user' }, 'address', 'ASC']],
    });

    // Group by zone so the rider can deliver zone-by-zone
    const byZone = {};
    for (const r of responses) {
      const z = r.zone;
      if (!byZone[z]) byZone[z] = [];
      byZone[z].push({
        response_id: r.id,
        is_special_case: r.is_special_case,
        name: r.user.name,
        phone: r.user.phone,
        address: r.user.address,
        zone: z,
      });
    }

    return success(res, {
      statusCode: 200,
      message: 'Delivery list fetched',
      data: {
        poll_date: poll.date,
        total: responses.length,
        by_zone: byZone,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/tracking/:id
// Access: super_admin
//
// Hard deletes a rider. If they are today's assigned rider the assignment
// is cleared first so the poll row isn't left with a dangling FK.
// ---------------------------------------------------------------------------
const deleteRider = async (req, res, next) => {
  try {
    const { id } = req.params;

    const rider = await Rider.findByPk(id);
    if (!rider) {
      return error(res, { statusCode: 404, message: 'Rider not found' });
    }

    // Clear assignment if this rider is assigned to today's poll.
    const poll = await getTodaysPoll();
    if (poll && poll.assigned_rider_id === rider.id) {
      poll.assigned_rider_id = null;
      await poll.save();
    }

    await rider.destroy();

    return success(res, {
      statusCode: 200,
      message: 'Rider deleted successfully',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  riderLogin,
  createRider,
  getAllRiders,
  assignTodaysRider,
  toggleRider,
  updateLocationManual,
  pushLocation,
  getActiveRider,
  getDeliveryList,
  deleteRider,
};
