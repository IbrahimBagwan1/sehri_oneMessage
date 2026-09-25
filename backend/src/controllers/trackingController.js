'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const { resolveZone } = require('../utils/resolveZone');
const googleMapsService = require('../services/googleMapsService');
const etaComputationService = require('../services/etaComputationService');
const socketService = require('../services/socketService');
const logger = require('../utils/logger');

const { Rider, Poll, PollResponse, User, Location, DeliveryStop } = db;

// ---------------------------------------------------------------------------
// Shared: compute today's deliverable {location_id → packet_count} map.
//
// Reuses the same predicate as getDeliveryList: yes-votes minus approved
// dont_want, plus approved want. Everyone at the same PG (same
// location_id) collapses into a single packet count for that PG. PGs
// with no coord pin are still returned (a rider can still deliver
// there manually; only the map polyline degrades — the packet count
// and stop entry itself are unaffected).
// ---------------------------------------------------------------------------
const computeDeliverablePGs = async (pollId) => {
  const responses = await PollResponse.findAll({
    where: {
      poll_id: pollId,
      [Op.or]: [
        {
          response: 'yes',
          [Op.not]: {
            is_special_case: true,
            special_case_type: 'dont_want',
            sehri_allowed: 'approved',
          },
        },
        {
          is_special_case: true,
          special_case_type: 'want',
          sehri_allowed: 'approved',
        },
      ],
    },
    include: [
      { model: User, as: 'user', attributes: ['id', 'location_id'] },
    ],
    attributes: ['id', 'zone'],
  });

  // Walk each user's location_id up the chain to the first ancestor
  // with coords — that's the delivery destination. If nothing in the
  // chain has coords, still count the packet under the user's raw
  // location_id so it appears in the stop list (rider knows to go
  // there, ETA/polyline just degrade).
  const byPg = new Map(); // location_id → { count, coord_location_id (may be null) }
  for (const r of responses) {
    const rootId = r.user?.location_id;
    if (!rootId) continue;
    const dest = await resolveDeliveryDestination(rootId);
    // Key by the PG the user actually belongs to (rootId), so two users
    // at the same PG never split into two stops even if their PG has
    // no coord and both resolve up to the zone.
    const key = rootId;
    if (!byPg.has(key)) {
      byPg.set(key, {
        location_id:      key,
        packet_count:     0,
        coord_location_id: dest?.source_location_id || null,
        lat: dest?.lat ?? null,
        lng: dest?.lng ?? null,
      });
    }
    byPg.get(key).packet_count += 1;
  }
  return Array.from(byPg.values());
};

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
// Internal helper — resolve the SHARED delivery coordinate for a user.
//
// The tracking destination is per-location, not per-individual. Two
// users at the same PG must see the identical rider→destination path
// and the same ETA. To guarantee that we walk the Location parent
// chain — starting from the user's assigned location — and return the
// first row that has both latitude AND longitude set. This means every
// user at "Rehmat PG" resolves to that PG's single pinned coord (set
// once by super admin via the coordinate picker), never to a
// geocoded-from-free-text address which would produce subtly different
// coords per user.
//
// Returns { lat, lng, source_location_id, source_location_type,
//           source_location_name } or null if nothing in the chain has coords.
// ---------------------------------------------------------------------------
const resolveDeliveryDestination = async (locationId) => {
  if (!locationId) return null;
  let current = await Location.findByPk(locationId);
  let hops = 0;
  const MAX_HOPS = 10; // safety guard against accidental cycles
  while (current && hops < MAX_HOPS) {
    if (current.latitude != null && current.longitude != null) {
      return {
        lat: Number(current.latitude),
        lng: Number(current.longitude),
        source_location_id: current.id,
        source_location_type: current.type,
        source_location_name: current.name,
      };
    }
    if (!current.parent_id) return null;
    current = await Location.findByPk(current.parent_id);
    hops += 1;
  }
  return null;
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

    // Same three-way split as the member login (see authController):
    // no account / suspended / wrong password are different answers.
    if (!rider) {
      return error(res, {
        statusCode: 404,
        message: 'No rider account found for this number. Ask a super admin to add you.',
        code: 'NO_ACCOUNT_FOUND',
      });
    }

    if (!rider.is_active) {
      return error(res, {
        statusCode: 403,
        message: 'Your rider account has been deactivated. Contact a super admin to restore it.',
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
//
// Each row includes `is_assigned_today` so the frontend can visibly mark
// the currently-assigned rider (and swap the "Assign today" button for
// an "Assigned / Remove" pair) without a second round-trip.
// ---------------------------------------------------------------------------
const getAllRiders = async (req, res, next) => {
  try {
    const [riders, todaysPoll] = await Promise.all([
      Rider.findAll({
        include: [
          {
            model: Location,
            as: 'zone',
            attributes: ['id', 'name'],
          },
        ],
        order: [['created_at', 'ASC']],
      }),
      getTodaysPoll(),
    ]);

    // Multi-rider: derive is_assigned_today from delivery_stops so it
    // stays correct when a super admin assigns 2+ riders. Fall back
    // to legacy poll.assigned_rider_id if the poll has no stops yet
    // (single-rider legacy flow — assignTodaysRider only sets the FK).
    let assignedRiderIds = new Set();
    if (todaysPoll) {
      const rows = await DeliveryStop.findAll({
        where: { poll_id: todaysPoll.id },
        attributes: [
          [db.sequelize.fn('DISTINCT', db.sequelize.col('rider_id')), 'rider_id'],
        ],
        raw: true,
      });
      for (const r of rows) if (r.rider_id) assignedRiderIds.add(r.rider_id);
      if (assignedRiderIds.size === 0 && todaysPoll.assigned_rider_id) {
        assignedRiderIds.add(todaysPoll.assigned_rider_id);
      }
    }

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
        is_assigned_today: assignedRiderIds.has(r.id),
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
// PATCH /api/tracking/unassign-today
// Access: super_admin
//
// Clears today's rider assignment. There is only ever one assigned rider
// per day, so this is a no-arg operation — no rider id needed. Idempotent:
// returns 200 with a friendly message whether or not anyone was assigned.
//
// Notes:
//   • If the assigned rider is mid-delivery (rider.status === 'delivering'),
//     we DO NOT touch rider.status — the rider app owns that flag. Clearing
//     the assignment stops the user track screen from showing them, which
//     is the intent (super admin wants them off today's roster).
//   • Kept as a dedicated route rather than overloading assignTodaysRider
//     with a null id so validation stays trivial and the audit log is
//     legible.
// ---------------------------------------------------------------------------
const unassignTodaysRider = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();
    if (!poll) {
      return error(res, {
        statusCode: 404,
        message: 'No poll found for today.',
      });
    }

    if (!poll.assigned_rider_id) {
      return success(res, {
        statusCode: 200,
        message: 'No rider was assigned for today.',
        data: { poll_id: poll.id, poll_date: poll.date, cleared: false },
      });
    }

    const priorRiderId = poll.assigned_rider_id;
    poll.assigned_rider_id = null;
    await poll.save();

    // Best-effort: emit a done event so any open user track screens
    // hide the rider marker immediately instead of waiting for the next
    // poll cycle. Wrapped in try/catch — the response must still succeed
    // if the socket layer is missing (tests, etc.).
    try {
      const rider = await Rider.findByPk(priorRiderId, { attributes: ['zone_location_id', 'name'] });
      if (rider) {
        socketService.emitRiderPosition(rider.zone_location_id, {
          rider_id: priorRiderId,
          name:     rider.name,
          status:   'done',
          at:       new Date().toISOString(),
        });
      }
    } catch (_) { /* noop */ }

    logger.info(`[tracking] super_admin=${req.auth.id} cleared today's rider assignment (was ${priorRiderId})`);

    return success(res, {
      statusCode: 200,
      message: "Today's rider assignment cleared.",
      data: {
        poll_id: poll.id,
        poll_date: poll.date,
        cleared: true,
        prior_rider_id: priorRiderId,
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

    const prevStatus = rider.status;

    rider.latitude = lat;
    rider.longitude = lng;
    if (current_address !== undefined) rider.current_address = current_address;
    if (eta_minutes !== undefined) rider.eta_minutes = parseInt(eta_minutes) || null;
    if (status) rider.status = status;

    await rider.save();

    // Broadcast the raw position to every subscribed user IMMEDIATELY —
    // this is what moves the marker on the user's tracking map. It's
    // deliberately decoupled from the ETA compute path below because
    // etaComputationService is heavily throttled (Distance Matrix
    // quota) and short-circuits when there are no destinations with
    // GPS coords. Users at un-geocoded PGs still deserve to see the
    // rider marker even without an ETA number.
    if (rider.status === 'delivering') {
      try {
        socketService.emitRiderPosition(rider.zone_location_id, {
          rider_id:   rider.id,
          name:       rider.name,
          latitude:   lat,
          longitude:  lng,
          status:     rider.status,
          eta_minutes: rider.eta_minutes ?? null,
          at:         new Date().toISOString(),
        });
      } catch (err) {
        logger.warn(`[tracking] emitRiderPosition failed: ${err.message}`);
      }
    }

    // ETA recompute — fire-and-forget so the hot-path response stays fast.
    // The service is internally throttled (100m OR 30s) so we can call
    // it on every push without burning Distance Matrix quota.
    if (rider.status === 'delivering') {
      etaComputationService
        .updateETAsForRider(rider, lat, lng)
        .catch((err) => logger.warn(`[tracking] eta recompute error: ${err.message}`));
    } else if (prevStatus === 'delivering' && rider.status === 'done') {
      // Rider just wrapped up — clear throttle state + notify open maps.
      etaComputationService.onRiderStopped(rider);
    }

    // Server-side reverse-geocode fallback: the rider app already tries to
    // resolve an address on-device, but if the device can't (offline
    // geocoder failure, denied permission, etc.) we backfill it here.
    // Fired forget-style — we don't await this so the hot-path response
    // stays under a few ms.
    if (!current_address && googleMapsService.isConfigured()) {
      googleMapsService
        .reverseGeocode({ lat, lng })
        .then(async (resolved) => {
          if (resolved) {
            try {
              await Rider.update(
                { current_address: resolved },
                { where: { id: rider.id } }
              );
            } catch (bgErr) {
              logger.warn(`[tracking] background reverse-geocode save failed: ${bgErr.message}`);
            }
          }
        })
        .catch((bgErr) => {
          logger.warn(`[tracking] background reverse-geocode failed: ${bgErr.message}`);
        });
    }

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
// GET /api/tracking/eta
// Access: requireUserAccess (user, or admin/super_admin with linked user)
//
// Returns the driving ETA from today's assigned rider's live position to
// the calling user's registered address. The user's address is geocoded on
// the fly — a future optimization would cache the (address, lat, lng)
// tuple on the users row so we don't hit Geocode on every ETA call.
// ---------------------------------------------------------------------------
const getEta = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();
    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll for today',
        data: { eta: null },
      });
    }

    // Multi-rider resolution — same rule getActiveRider uses. Find the
    // delivery_stop for the calling user's PG; the stop's rider is
    // whose ETA we compute. Falls back to legacy poll.assigned_rider_id
    // for the pre-multi-rider flow.
    const userForStop = await User.findByPk(req.actingUserId, {
      attributes: ['id', 'location_id'],
    });
    let riderId = null;
    let stopRow = null;
    if (userForStop?.location_id) {
      stopRow = await DeliveryStop.findOne({
        where: { poll_id: poll.id, location_id: userForStop.location_id },
        attributes: ['id', 'rider_id', 'status'],
      });
      if (stopRow) riderId = stopRow.rider_id;
    }
    if (!riderId && poll.assigned_rider_id) riderId = poll.assigned_rider_id;

    if (!riderId) {
      return success(res, {
        statusCode: 200,
        message: 'No rider assigned to your PG today',
        data: { eta: null },
      });
    }

    // If this stop is already delivered, short-circuit — no point
    // computing an ETA to a stop that's done.
    if (stopRow?.status === 'delivered') {
      return success(res, {
        statusCode: 200,
        message: 'Your Sehri has been delivered.',
        data: { eta: null, stop: { id: stopRow.id, status: 'delivered' } },
      });
    }

    const rider = await Rider.findByPk(riderId, {
      attributes: ['id', 'name', 'latitude', 'longitude', 'status', 'is_active'],
    });

    if (!rider || !rider.is_active || rider.status === 'done') {
      return success(res, {
        statusCode: 200,
        message: 'Rider is not currently delivering',
        data: { eta: null },
      });
    }
    if (rider.latitude == null || rider.longitude == null) {
      return success(res, {
        statusCode: 200,
        message: 'Rider has not started broadcasting location yet',
        data: { eta: null },
      });
    }

    const user = await User.findByPk(req.actingUserId, {
      attributes: ['id', 'address', 'city', 'location_id'],
    });
    if (!user) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }

    // SHARED-DESTINATION SEMANTICS
    // ----------------------------
    // Prefer the fixed coordinate pinned on the user's Location (or the
    // nearest ancestor Location that has one). Every user at the same PG
    // resolves to the same lat/lng — critical so 10 users in one hostel
    // see the same rider→home line and the same ETA numbers, not 10
    // slightly-different geocoded results derived from their individual
    // address text.
    //
    // Only fall back to geocoding the free-text address if NO Location
    // in the parent chain has coords (super admin never pinned this PG).
    // In that case each user gets a per-user degrade, which is the best
    // we can do until the coord picker is used for that address.
    let destination = await resolveDeliveryDestination(user.location_id);
    let destination_source = destination ? 'location_pin' : null;

    if (!destination) {
      if (!googleMapsService.isConfigured()) {
        return error(res, {
          statusCode: 422,
          message:
            "Your PG doesn't have a map pin yet and no fallback geocoder is configured. " +
            "Ask an admin to pin your PG's location.",
        });
      }
      if (!user.address) {
        return error(res, {
          statusCode: 422,
          message:
            "Your PG doesn't have a map pin yet and your profile has no address to " +
            "fall back on. Ask an admin to pin your PG's location.",
        });
      }
      const fullAddress = user.city ? `${user.address}, ${user.city}` : user.address;
      const geo = await googleMapsService.geocode(fullAddress);
      if (!geo) {
        return error(res, {
          statusCode: 422,
          message: 'Could not locate your address on the map',
        });
      }
      destination = geo;
      destination_source = 'geocoded_fallback';
    }

    if (!googleMapsService.isConfigured()) {
      return error(res, {
        statusCode: 503,
        message: 'ETA service is not configured on the server',
      });
    }

    // Directions API returns a real road-following polyline AND the
    // driving distance/duration in one call — cheaper and more useful
    // than distanceMatrix (which only returns numbers, no path). We fall
    // back to distanceMatrix only if directions failed or is degraded, so
    // the user still sees an ETA even when the polyline isn't available.
    const origin = { lat: Number(rider.latitude), lng: Number(rider.longitude) };
    const route  = await googleMapsService.directions({
      origin,
      destination,
      mode: 'driving',
    });

    let distanceMeters = route?.distanceMeters ?? null;
    let durationSeconds = route?.durationSeconds ?? null;
    let distanceText   = route?.distanceText ?? null;
    let durationText   = route?.durationText ?? null;

    if (durationSeconds == null) {
      try {
        const dm = await googleMapsService.distanceMatrix({
          origin,
          destination,
          mode: 'driving',
        });
        distanceMeters   = dm.distanceMeters;
        durationSeconds  = dm.durationSeconds;
        distanceText     = dm.distanceText;
        durationText     = dm.durationText;
      } catch (dmErr) {
        // Both APIs failed — still return the destination + rider so the
        // map draws two markers and a straight-line fallback polyline.
        logger.warn(`[tracking] both directions and distanceMatrix failed: ${dmErr.message}`);
      }
    }

    // Convert the decoded [lat,lng] tuples into {latitude, longitude}
    // objects — matches the shape LeafletMap's polyline prop expects.
    const routePath = Array.isArray(route?.path) && route.path.length >= 2
      ? route.path.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
      : null;

    return success(res, {
      statusCode: 200,
      message: 'ETA computed',
      data: {
        rider: {
          id: rider.id,
          name: rider.name,
          latitude: Number(rider.latitude),
          longitude: Number(rider.longitude),
          status: rider.status,
        },
        // Destination coords so the frontend can drop a "your home" marker.
        // `source` tells the client whether these came from the PG's fixed
        // pin (shared across every user at that PG — the correct case) or
        // from a per-user geocode fallback (informational only, not shown
        // in normal UI but useful for debugging).
        destination: {
          latitude:  destination.lat,
          longitude: destination.lng,
          source:    destination_source,
        },
        // Real driving route (Google Directions). Null when Directions
        // fell back or both APIs failed — frontend draws a straight line
        // between rider and destination as a graceful degrade.
        route: routePath,
        eta: {
          distance_meters: distanceMeters,
          distance_text:   distanceText,
          duration_seconds: durationSeconds,
          duration_text:   durationText,
          eta_minutes:
            durationSeconds != null ? Math.round(durationSeconds / 60) : null,
        },
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
    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll for today',
        data: { rider: null },
      });
    }

    // MULTI-RIDER resolution:
    // Find the delivery_stop for the calling user's PG (their
    // location_id, walked up if needed to match a stop). Whatever
    // rider owns that stop is the rider the user should see. This
    // makes multi-rider correctness fall out for free — two users at
    // the same PG hit the same stop hit the same rider; two PGs
    // served by different riders each resolve to their own rider.
    //
    // We also expose the specific stop's status/id so the user's
    // track screen can flip to a "delivered" state without a separate
    // fetch.
    const user = await User.findByPk(req.actingUserId, {
      attributes: ['id', 'location_id'],
    });
    if (!user || !user.location_id) {
      return success(res, {
        statusCode: 200,
        message: 'Your profile has no location yet.',
        data: { rider: null },
      });
    }

    // The stop's location_id is the PG the user belongs to (we key
    // stops by rootId in computeDeliverablePGs). So the lookup is a
    // direct match on user.location_id.
    let stop = await DeliveryStop.findOne({
      where: { poll_id: poll.id, location_id: user.location_id },
      include: [
        {
          model: Rider, as: 'rider',
          include: [{ model: Location, as: 'zone', attributes: ['id', 'name'] }],
          attributes: [
            'id', 'name', 'phone', 'zone_location_id',
            'latitude', 'longitude', 'current_address',
            'eta_minutes', 'status', 'is_active',
          ],
        },
      ],
    });

    // Legacy single-rider fallback: if no stops have been generated
    // yet for this poll but assigned_rider_id is set (pre-multi-rider
    // flow), surface that rider for every user.
    let rider = stop?.rider || null;
    if (!rider && poll.assigned_rider_id) {
      rider = await Rider.findByPk(poll.assigned_rider_id, {
        include: [{ model: Location, as: 'zone', attributes: ['id', 'name'] }],
        attributes: [
          'id', 'name', 'phone', 'zone_location_id',
          'latitude', 'longitude', 'current_address',
          'eta_minutes', 'status', 'is_active',
        ],
      });
    }

    if (!rider || !rider.is_active) {
      return success(res, {
        statusCode: 200,
        message: 'No rider assigned to your PG today',
        data: { rider: null },
      });
    }

    // If the stop itself is already delivered OR the rider's whole
    // run is done, surface that so the client's empty state is
    // accurate. We still return the rider so the client can show
    // "delivered" attribution.
    const isDoneForThisUser = stop?.status === 'delivered' || rider.status === 'done';

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
          status: isDoneForThisUser ? 'done' : rider.status,
          zone: rider.zone ? { id: rider.zone.id, name: rider.zone.name } : null,
        },
        stop: stop ? {
          id: stop.id,
          status: stop.status,
          delivered_at: stop.delivered_at,
        } : null,
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

    // MULTI-RIDER: the rider is "assigned" if they have at least one
    // delivery_stop today. Legacy single-rider check (assigned_rider_id)
    // is kept as a fallback for polls that haven't been migrated to
    // the delivery_stops model yet.
    const myStopCount = await DeliveryStop.count({
      where: { poll_id: poll.id, rider_id: req.auth.id },
    });
    const legacyMatch = poll.assigned_rider_id === req.auth.id;
    if (myStopCount === 0 && !legacyMatch) {
      return error(res, {
        statusCode: 403,
        message: 'You are not assigned as a delivery rider today.',
      });
    }

    // MULTI-RIDER predicate: only surface users at PGs this rider is
    // responsible for. Falls back to all deliverable responses if no
    // stops exist (legacy flow) so single-rider polls still see the
    // full list.
    let stopLocationIds = null;
    if (myStopCount > 0) {
      const myStops = await DeliveryStop.findAll({
        where: { poll_id: poll.id, rider_id: req.auth.id },
        attributes: ['location_id'],
        raw: true,
      });
      stopLocationIds = myStops.map((s) => s.location_id);
    }

    // Fetch all yes-voters, excluding dont_want approved special cases.
    // A response is deliverable if:
    //   (response = 'yes' AND NOT (is_special_case = true AND special_case_type = 'dont_want' AND sehri_allowed = 'approved'))
    //   OR
    //   (is_special_case = true AND special_case_type = 'want' AND sehri_allowed = 'approved')
    const userWhere = stopLocationIds ? { location_id: { [Op.in]: stopLocationIds } } : undefined;
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
          where: userWhere,
          required: !!userWhere, // INNER JOIN when we're filtering, LEFT JOIN otherwise
          // Eager-load the PG row so the rider sees the real hostel name
          // from the locations table, not just the resident's free-text
          // "building / flat / landmark" string. Riders navigate by PG
          // name; the free-text field is a within-PG detail.
          include: [{ model: Location, as: 'location', attributes: ['id', 'name', 'type'] }],
        },
      ],
      attributes: ['id', 'zone', 'is_special_case', 'special_case_type'],
      order: [[{ model: User, as: 'user' }, 'address', 'ASC']],
    });

    // Group by zone so the rider can deliver zone-by-zone.
    //
    // A response whose member has erased their account has user_id NULL
    // and so no address to deliver to. Erasure already withdraws votes on
    // today's and future polls, so this should never fire for a live
    // round — but the delivery list can be pulled for any poll, and a
    // rider must never be handed a stop with no destination.
    const byZone = {};
    let orphaned = 0;
    for (const r of responses) {
      if (!r.user) { orphaned += 1; continue; }
      const z = r.zone;
      if (!byZone[z]) byZone[z] = [];
      byZone[z].push({
        response_id: r.id,
        is_special_case: r.is_special_case,
        name: r.user.name,
        phone: r.user.phone,
        // pg_name is the locations-table name the rider navigates by.
        // `address` stays as the resident's own free-text detail
        // (flat number / landmark) shown as a secondary line.
        pg_name: r.user.location?.name || null,
        location_id: r.user.location_id,
        address: r.user.address,
        zone: z,
      });
    }

    return success(res, {
      statusCode: 200,
      message: 'Delivery list fetched',
      data: {
        poll_date: poll.date,
        total: responses.length - orphaned,
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

// ---------------------------------------------------------------------------
// Internal: recompute the optimized sort_order for a rider's pending stops
// via Google Directions waypoint optimization.
//
// Called when:
//   • a rider is first assigned (initial ordering)
//   • a stop is marked delivered (ordering may improve for what's left)
//
// If the rider has 0 or 1 pending stops, we skip the API call entirely.
// If Directions fails/rate-limits, we leave whatever sort_order was there;
// the frontend still shows the stops (unordered fallback = alphabetical
// by name in the UI). We never throw — route optimization is a
// best-effort enhancement, not a correctness dependency.
// ---------------------------------------------------------------------------
const recomputeRiderRouteOrder = async (riderId, pollId) => {
  try {
    const rider = await Rider.findByPk(riderId, {
      attributes: ['id', 'latitude', 'longitude', 'zone_location_id'],
    });
    if (!rider) return;

    const stops = await DeliveryStop.findAll({
      where: { poll_id: pollId, rider_id: riderId, status: 'pending' },
      include: [{ model: Location, as: 'location', attributes: ['id', 'name', 'latitude', 'longitude', 'parent_id'] }],
      order: [['sort_order', 'ASC']],
    });
    if (stops.length <= 1) return; // trivially "ordered"

    // Resolve each stop's coordinate — walk up the chain if the PG
    // itself has none. Stops with no resolvable coord are pushed to
    // the end of the order (they can't participate in optimization).
    const withCoords = [];
    const noCoords   = [];
    for (const s of stops) {
      let coord = null;
      if (s.location?.latitude != null && s.location?.longitude != null) {
        coord = { lat: Number(s.location.latitude), lng: Number(s.location.longitude) };
      } else {
        const resolved = await resolveDeliveryDestination(s.location_id);
        if (resolved) coord = { lat: resolved.lat, lng: resolved.lng };
      }
      if (coord) withCoords.push({ stop: s, coord });
      else       noCoords.push({ stop: s });
    }

    if (withCoords.length <= 1) return;

    // Origin: rider's current GPS if we have it, else the first
    // coord-having stop (which then becomes leg[0].destination). This
    // gives us a sane route even before the rider starts broadcasting.
    let origin = null;
    if (rider.latitude != null && rider.longitude != null) {
      origin = { lat: Number(rider.latitude), lng: Number(rider.longitude) };
    } else {
      origin = withCoords[0].coord;
    }

    // Google's Directions API returns the optimized waypoint order and
    // leg-by-leg distances. We use it to derive sort_order 1..N for
    // the rider's pending stops. Setting destination = last stop is
    // arbitrary; Google will still optimize the middle waypoints. If
    // we had a fixed "return to base" address we'd use that instead.
    //
    // We choose the stop furthest from the origin as the destination
    // and let the rest be waypoints — Google reorders the waypoints
    // but leaves origin/destination fixed, so this gives good results.
    let furthestIdx = 0;
    let furthestD2 = -1;
    for (let i = 0; i < withCoords.length; i++) {
      const c = withCoords[i].coord;
      const d2 =
        Math.pow(c.lat - origin.lat, 2) + Math.pow(c.lng - origin.lng, 2);
      if (d2 > furthestD2) {
        furthestD2 = d2;
        furthestIdx = i;
      }
    }
    const destination = withCoords[furthestIdx].coord;
    const waypointStops = withCoords.filter((_, i) => i !== furthestIdx);

    let orderedStops;
    if (waypointStops.length === 0) {
      orderedStops = [withCoords[furthestIdx].stop];
    } else {
      const dir = await googleMapsService.directions({
        origin,
        destination,
        waypoints: waypointStops.map((w) => w.coord),
        optimizeWaypoints: true,
      });
      if (!dir || !Array.isArray(dir.waypointOrder)) {
        // Directions failed — leave stops in whatever order they were.
        return;
      }
      // dir.waypointOrder is a permutation of [0..waypointStops.length-1]
      // in Google's chosen order. Final visit order is:
      //   waypointStops[order[0]], waypointStops[order[1]], …, then destination.
      const ordered = dir.waypointOrder.map((idx) => waypointStops[idx].stop);
      orderedStops = [...ordered, withCoords[furthestIdx].stop];
    }

    // Write sort_order back: 1..N for coord-having stops in optimized
    // order, then N+1..N+M for stops we couldn't route (alphabetical
    // by PG name for deterministic display).
    noCoords.sort((a, b) => (a.stop.location?.name || '').localeCompare(b.stop.location?.name || ''));

    let n = 1;
    for (const s of orderedStops) {
      await s.update({ sort_order: n++ });
    }
    for (const { stop } of noCoords) {
      await stop.update({ sort_order: n++ });
    }
  } catch (err) {
    logger.warn(`[tracking] route recompute failed for rider=${riderId} poll=${pollId}: ${err.message}`);
  }
};

// ---------------------------------------------------------------------------
// POST /api/tracking/delivery-run/assign
// Access: super_admin
// Body: { rider_ids: [uuid, ...] }
//
// Multi-rider assignment. Replaces the single-rider assumption baked
// into polls.assigned_rider_id. Zone-based auto-split:
//
//   • For each PG that needs delivery today, find every rider in
//     rider_ids whose zone_location_id matches the PG's zone (or is
//     null = "serves all zones").
//   • Round-robin the PGs of a zone among the eligible riders. If no
//     rider matches a zone, PGs in that zone are dropped from the run
//     (super admin needs to add a rider for that zone) — returned in
//     `orphaned_pgs` so the UI can warn.
//   • Wipes the existing delivery_stops for this poll and regenerates,
//     so re-running this endpoint is idempotent (safe to click "Assign
//     riders" twice with different rider sets).
//
// For UI back-compat, polls.assigned_rider_id is set to rider_ids[0]
// (a "primary" rider) so any legacy single-rider display still works.
// Callers should prefer GET /delivery-run to see the full picture.
// ---------------------------------------------------------------------------
const assignDeliveryRun = async (req, res, next) => {
  const t = await db.sequelize.transaction();
  try {
    const { rider_ids: riderIds } = req.body || {};
    if (!Array.isArray(riderIds) || riderIds.length === 0) {
      await t.rollback();
      return error(res, {
        statusCode: 400,
        message: 'rider_ids must be a non-empty array of rider UUIDs.',
      });
    }
    // Cap on paranoia — 20 riders is more than any real Sehri run.
    if (riderIds.length > 20) {
      await t.rollback();
      return error(res, {
        statusCode: 400,
        message: 'At most 20 riders can be assigned to a single delivery run.',
      });
    }

    const poll = await getTodaysPoll();
    if (!poll) {
      await t.rollback();
      return error(res, {
        statusCode: 404,
        message: "No poll for today. Create today's poll first.",
      });
    }

    const riders = await Rider.findAll({
      where: { id: { [Op.in]: riderIds }, is_active: true },
      attributes: ['id', 'name', 'zone_location_id'],
      transaction: t,
    });
    if (riders.length !== riderIds.length) {
      await t.rollback();
      return error(res, {
        statusCode: 400,
        message: 'One or more rider_ids are unknown or inactive.',
      });
    }

    // Compute today's PGs (packet counts per PG) — coord-less PGs still
    // count. computeDeliverablePGs is transaction-agnostic (it hits
    // the same connection pool) so we run it without the transaction
    // context; the writes below are what needs to be atomic.
    const pgs = await computeDeliverablePGs(poll.id);
    if (pgs.length === 0) {
      // Still valid — a super admin might assign riders before anyone
      // votes yes; the run is just empty and can be re-run later.
      await DeliveryStop.destroy({ where: { poll_id: poll.id }, transaction: t });
      poll.assigned_rider_id = riderIds[0];
      await poll.save({ transaction: t });
      await t.commit();
      return success(res, {
        statusCode: 200,
        message: 'Riders assigned. No PGs need delivery yet — stops will be regenerated on the next assign.',
        data: {
          poll_id: poll.id,
          rider_count: riders.length,
          stop_count: 0,
          orphaned_pgs: [],
        },
      });
    }

    // Group PGs by the zone snapshot on their poll responses so
    // round-robin only matches riders eligible for THAT zone. We
    // resolve each PG's zone by looking at its own Location record's
    // parent chain (same rule the vote-time snapshot uses).
    const pgsByZone = new Map(); // zone_location_id → [pg,...]
    for (const pg of pgs) {
      // Walk up the PG's Location chain to find the zone ancestor.
      const zone = await resolveZone(pg.location_id, db);
      const zoneId = zone?.id || null;
      if (!pgsByZone.has(zoneId)) pgsByZone.set(zoneId, []);
      pgsByZone.get(zoneId).push(pg);
    }

    // Deterministic PG ordering within a zone so round-robin is stable.
    for (const arr of pgsByZone.values()) {
      arr.sort((a, b) => a.location_id.localeCompare(b.location_id));
    }

    // For each zone, pick eligible riders: those whose zone matches
    // OR who serve all zones (zone_location_id === null).
    const eligibleForZone = (zoneId) =>
      riders.filter((r) => r.zone_location_id === zoneId || r.zone_location_id == null);

    // Wipe existing stops for a clean regenerate.
    await DeliveryStop.destroy({ where: { poll_id: poll.id }, transaction: t });

    const stopsToCreate = [];
    const orphanedPgs = [];
    for (const [zoneId, zonePgs] of pgsByZone) {
      const eligible = eligibleForZone(zoneId);
      if (eligible.length === 0) {
        // No rider covers this zone — collect for the response so the
        // super admin can add a rider and re-run assign.
        for (const pg of zonePgs) orphanedPgs.push(pg.location_id);
        continue;
      }
      // Round-robin: PG i → eligible[i % eligible.length]
      for (let i = 0; i < zonePgs.length; i++) {
        const rider = eligible[i % eligible.length];
        const pg = zonePgs[i];
        stopsToCreate.push({
          poll_id:      poll.id,
          rider_id:     rider.id,
          location_id:  pg.location_id,
          packet_count: pg.packet_count,
          status:       'pending',
          sort_order:   null,
        });
      }
    }

    if (stopsToCreate.length > 0) {
      await DeliveryStop.bulkCreate(stopsToCreate, { transaction: t });
    }

    // Legacy backcompat — the old assigned_rider_id column is still
    // read by a few UI paths. Set it to the first rider so those
    // paths keep working; new callers use GET /delivery-run.
    poll.assigned_rider_id = riderIds[0];
    await poll.save({ transaction: t });

    await t.commit();

    // Kick off route optimization per rider — fire-and-forget so the
    // assign response returns fast. Each recomputeRiderRouteOrder
    // catches its own errors and never throws.
    for (const rider of riders) {
      recomputeRiderRouteOrder(rider.id, poll.id).catch((err) =>
        logger.warn(`[tracking] initial route recompute failed for ${rider.id}: ${err.message}`)
      );
    }

    logger.info(
      `[tracking] super_admin=${req.auth.id} assigned delivery run for poll=${poll.id}: ` +
      `${riders.length} rider(s), ${stopsToCreate.length} stop(s), ${orphanedPgs.length} orphan PG(s)`
    );

    return success(res, {
      statusCode: 200,
      message: `Assigned ${stopsToCreate.length} stop${stopsToCreate.length === 1 ? '' : 's'} to ${riders.length} rider${riders.length === 1 ? '' : 's'}.`,
      data: {
        poll_id: poll.id,
        rider_count: riders.length,
        stop_count: stopsToCreate.length,
        orphaned_pgs: orphanedPgs,
      },
    });
  } catch (err) {
    try { await t.rollback(); } catch (_) { /* noop */ }
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/tracking/delivery-run
// Access: super_admin
//
// Full super-admin view of today's delivery run: every assigned rider
// with their stops, status, delivered count, etc. Used by the
// dashboard/riders screen to visualize the current run.
// ---------------------------------------------------------------------------
const getDeliveryRun = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();
    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll for today.',
        data: { poll: null, riders: [] },
      });
    }

    const stops = await DeliveryStop.findAll({
      where: { poll_id: poll.id },
      include: [
        { model: Rider,    as: 'rider',    attributes: ['id', 'name', 'phone', 'status', 'latitude', 'longitude', 'zone_location_id'] },
        { model: Location, as: 'location', attributes: ['id', 'name', 'parent_id', 'latitude', 'longitude'] },
      ],
      order: [['rider_id', 'ASC'], ['sort_order', 'ASC']],
    });

    // Group by rider for the response shape.
    const byRider = new Map();
    for (const s of stops) {
      const rid = s.rider_id;
      if (!byRider.has(rid)) {
        byRider.set(rid, {
          rider: s.rider ? {
            id: s.rider.id,
            name: s.rider.name,
            phone: s.rider.phone,
            status: s.rider.status,
            latitude: s.rider.latitude,
            longitude: s.rider.longitude,
          } : { id: rid },
          stops: [],
          total_stops: 0,
          delivered_stops: 0,
          total_packets: 0,
        });
      }
      const bucket = byRider.get(rid);
      bucket.stops.push({
        id: s.id,
        location_id:  s.location_id,
        location_name: s.location?.name || null,
        packet_count: s.packet_count,
        sort_order:   s.sort_order,
        status:       s.status,
        delivered_at: s.delivered_at,
      });
      bucket.total_stops += 1;
      bucket.total_packets += s.packet_count;
      if (s.status === 'delivered') bucket.delivered_stops += 1;
    }

    return success(res, {
      statusCode: 200,
      message: 'Delivery run fetched.',
      data: {
        poll: { id: poll.id, date: poll.date },
        riders: Array.from(byRider.values()),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/tracking/my-stops
// Access: rider (must be assigned to today's run)
//
// The rider's own stops for today's poll in optimized visit order,
// with each stop's PG name, coord, packet count, and status. Used by
// the rider's route screen to render the map + stop queue.
// ---------------------------------------------------------------------------
const getMyStops = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();
    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll for today.',
        data: { poll: null, stops: [] },
      });
    }

    const stops = await DeliveryStop.findAll({
      where: { poll_id: poll.id, rider_id: req.auth.id },
      include: [
        { model: Location, as: 'location', attributes: ['id', 'name', 'parent_id', 'latitude', 'longitude'] },
      ],
      order: [
        // Nulls last on sort_order.
        [db.sequelize.literal('sort_order IS NULL'), 'ASC'],
        ['sort_order', 'ASC'],
        ['created_at', 'ASC'],
      ],
    });

    if (stops.length === 0) {
      return success(res, {
        statusCode: 200,
        message: "You haven't been assigned any stops today.",
        data: { poll: { id: poll.id, date: poll.date }, stops: [] },
      });
    }

    // Resolve each stop's shared destination coord (walk up chain if
    // the PG itself doesn't have coords). This is the same coord the
    // user side resolves — guarantees rider and user see the identical
    // destination point.
    const out = [];
    for (const s of stops) {
      let lat = null;
      let lng = null;
      if (s.location?.latitude != null && s.location?.longitude != null) {
        lat = Number(s.location.latitude);
        lng = Number(s.location.longitude);
      } else {
        const resolved = await resolveDeliveryDestination(s.location_id);
        if (resolved) { lat = resolved.lat; lng = resolved.lng; }
      }
      out.push({
        id: s.id,
        location_id:  s.location_id,
        location_name: s.location?.name || 'PG',
        packet_count: s.packet_count,
        sort_order:   s.sort_order,
        status:       s.status,
        delivered_at: s.delivered_at,
        latitude:  lat,
        longitude: lng,
        has_pin:   lat != null && lng != null,
      });
    }

    // Bonus: compute the full route polyline through every pending
    // coord-having stop so the rider's map can draw the actual road
    // path. Origin is the rider's current GPS if available, else the
    // first stop. Fire-and-forget style — we return null on any
    // failure and the client falls back to numbered markers only.
    let routePolyline = null;
    try {
      const pending = out.filter((s) => s.status === 'pending' && s.has_pin);
      if (pending.length >= 1) {
        const me = await Rider.findByPk(req.auth.id, { attributes: ['latitude', 'longitude'] });
        const origin = (me?.latitude != null && me?.longitude != null)
          ? { lat: Number(me.latitude), lng: Number(me.longitude) }
          : { lat: pending[0].latitude, lng: pending[0].longitude };
        const destination = { lat: pending[pending.length - 1].latitude, lng: pending[pending.length - 1].longitude };
        const middle = pending.slice(0, -1).map((s) => ({ lat: s.latitude, lng: s.longitude }));
        // Route is already sorted server-side (sort_order), so we
        // pass optimizeWaypoints=false to preserve that visit order —
        // don't want Google to reshuffle the queue behind the rider's
        // back after they've started following it.
        const dir = await googleMapsService.directions({
          origin,
          destination,
          waypoints: middle,
          optimizeWaypoints: false,
        });
        if (dir && Array.isArray(dir.path) && dir.path.length >= 2) {
          routePolyline = dir.path.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
        }
      }
    } catch (dirErr) {
      logger.warn(`[tracking] my-stops polyline compute failed: ${dirErr.message}`);
    }

    // Aggregate summary — useful for the rider's header strip.
    const totalStops     = out.length;
    const deliveredStops = out.filter((s) => s.status === 'delivered').length;
    const pendingStops   = totalStops - deliveredStops;
    const totalPackets     = out.reduce((n, s) => n + (s.packet_count || 0), 0);
    const deliveredPackets = out
      .filter((s) => s.status === 'delivered')
      .reduce((n, s) => n + (s.packet_count || 0), 0);

    return success(res, {
      statusCode: 200,
      message: 'Your stops fetched.',
      data: {
        poll: { id: poll.id, date: poll.date },
        stops: out,
        route_polyline: routePolyline,
        summary: {
          total_stops:      totalStops,
          delivered_stops:  deliveredStops,
          pending_stops:    pendingStops,
          total_packets:    totalPackets,
          delivered_packets: deliveredPackets,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/tracking/stops/:id/mark-delivered
// Access: rider (must own the stop)
//
// Marks the stop delivered, advances the route (recomputes optimized
// order for whatever pending stops remain), and emits a socket event
// to every user at that PG so their track screen flips to complete.
// Idempotent — hitting it twice on the same stop returns the current
// state without re-emitting.
// ---------------------------------------------------------------------------
const markStopDelivered = async (req, res, next) => {
  try {
    const { id } = req.params;
    const stop = await DeliveryStop.findByPk(id);
    if (!stop) return error(res, { statusCode: 404, message: 'Stop not found.' });

    if (stop.rider_id !== req.auth.id) {
      return error(res, {
        statusCode: 403,
        message: 'You can only mark your own stops as delivered.',
      });
    }
    if (stop.status === 'delivered') {
      return success(res, {
        statusCode: 200,
        message: 'Stop was already marked delivered.',
        data: { id: stop.id, status: 'delivered', delivered_at: stop.delivered_at },
      });
    }

    stop.status                = 'delivered';
    stop.delivered_at          = new Date();
    stop.delivered_by_rider_id = req.auth.id;
    await stop.save();

    // Notify every user at this PG. We include the poll_id so stale
    // events from a different day don't confuse a client that
    // reconnected across midnight.
    try {
      const affectedUsers = await User.findAll({
        where: { location_id: stop.location_id, status: 'approved' },
        attributes: ['id'],
      });
      for (const u of affectedUsers) {
        socketService.emitStopDelivered(u.id, {
          poll_id:     stop.poll_id,
          stop_id:     stop.id,
          location_id: stop.location_id,
          delivered_at: stop.delivered_at.toISOString(),
        });
      }
    } catch (err) {
      logger.warn(`[tracking] failed to emit stop_delivered: ${err.message}`);
    }

    // Recompute route for whatever remains. Fire-and-forget so the
    // rider's tap-response stays fast.
    recomputeRiderRouteOrder(stop.rider_id, stop.poll_id).catch(() => {});

    return success(res, {
      statusCode: 200,
      message: 'Marked delivered.',
      data: {
        id: stop.id,
        status: stop.status,
        delivered_at: stop.delivered_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/tracking/my-route/recompute
// Access: rider (must be assigned)
//
// Rider-triggered route recompute — called when they tap "Start
// delivery" so the initial route reflects their actual live GPS
// origin instead of the coordinate we had when they were assigned.
// Idempotent; safe to call more than once.
// ---------------------------------------------------------------------------
const recomputeMyRoute = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();
    if (!poll) return error(res, { statusCode: 404, message: 'No poll for today.' });
    await recomputeRiderRouteOrder(req.auth.id, poll.id);
    return success(res, {
      statusCode: 200,
      message: 'Route recomputed.',
      data: { poll_id: poll.id },
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
  unassignTodaysRider,
  toggleRider,
  updateLocationManual,
  pushLocation,
  getActiveRider,
  getDeliveryList,
  deleteRider,
  getEta,
  assignDeliveryRun,
  getDeliveryRun,
  getMyStops,
  markStopDelivered,
  recomputeMyRoute,
};
