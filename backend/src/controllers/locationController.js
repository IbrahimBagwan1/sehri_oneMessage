'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

const { Location, User } = db;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Trim, collapse internal whitespace, and enforce a length budget on any
 * user-supplied location name. Returns the cleaned string or null if the
 * result is empty / too long.
 */
const cleanName = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 2 || trimmed.length > 150) return null;
  return trimmed;
};

/**
 * Coerce lat/lng from a request body. Returns
 *   { lat, lng, provided: true }  when BOTH are present and valid
 *   { provided: false }           when both are missing (creating unpinned)
 *   { error: '...' }              when partially or invalidly supplied
 */
const parseOptionalCoords = ({ latitude, longitude }) => {
  const bothMissing =
    (latitude === undefined || latitude === null || latitude === '') &&
    (longitude === undefined || longitude === null || longitude === '');
  if (bothMissing) return { provided: false };

  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: 'latitude must be a number between -90 and 90' };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: 'longitude must be a number between -180 and 180' };
  }
  return { lat, lng, provided: true };
};

/**
 * GET /api/locations?type=zone&parent_id=<uuid>
 *
 * PUBLIC — the registration screen and (eventually) the profile edit
 * flow both hit this before any token exists.
 */
const getLocations = async (req, res, next) => {
  try {
    const { type, parent_id } = req.query;

    const where = { is_active: true };
    if (type) where.type = type;
    if (parent_id) where.parent_id = parent_id;

    const locations = await Location.findAll({
      where,
      attributes: ['id', 'name', 'type', 'parent_id', 'latitude', 'longitude'],
      order: [['name', 'ASC']],
    });

    return success(res, {
      statusCode: 200,
      message: 'Locations fetched successfully',
      data: locations,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/locations/needs-coordinates
// Access: super_admin.
//
// Lists every location of type='address' that has no latitude/longitude
// yet — the coordinate-picker screen uses this as its worklist.
// ---------------------------------------------------------------------------
const getLocationsNeedingCoordinates = async (req, res, next) => {
  try {
    const rows = await Location.findAll({
      where: {
        type: 'address',
        is_active: true,
        [Op.or]: [{ latitude: null }, { longitude: null }],
      },
      include: [{ model: Location, as: 'parent', attributes: ['id', 'name', 'type'] }],
      attributes: ['id', 'name', 'type', 'parent_id', 'latitude', 'longitude', 'geocoded_at'],
      order: [['name', 'ASC']],
    });

    return success(res, {
      statusCode: 200,
      message: 'Locations needing coordinates fetched',
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/locations/addresses
// Access: super_admin.
//
// Every location of type='address' with its current coord state — used
// by the coordinate picker to review all PGs, not only the un-pinned
// ones. Includes parent (zone) so the picker can group visually.
// ---------------------------------------------------------------------------
const listAllAddresses = async (req, res, next) => {
  try {
    const rows = await Location.findAll({
      where: { type: 'address', is_active: true },
      include: [{ model: Location, as: 'parent', attributes: ['id', 'name'] }],
      attributes: ['id', 'name', 'type', 'parent_id', 'latitude', 'longitude', 'geocoded_at'],
      order: [['name', 'ASC']],
    });
    return success(res, {
      statusCode: 200,
      message: 'Addresses fetched',
      data: rows,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/locations/:id/coordinates
// Access: super_admin.
// Body: { latitude: number, longitude: number }
//
// Sets the pin on a location. Validates the ranges to prevent obviously
// bad coords from silently corrupting the ETA calculator.
// ---------------------------------------------------------------------------
const setCoordinates = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body || {};

    const lat = Number.parseFloat(latitude);
    const lng = Number.parseFloat(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return error(res, { statusCode: 400, message: 'latitude must be between -90 and 90' });
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return error(res, { statusCode: 400, message: 'longitude must be between -180 and 180' });
    }

    const loc = await Location.findByPk(id);
    if (!loc) return error(res, { statusCode: 404, message: 'Location not found' });

    loc.latitude = lat;
    loc.longitude = lng;
    loc.geocoded_at = new Date();
    await loc.save();

    logger.info(`[locations] Coordinates set for ${loc.type} "${loc.name}" (${id}): ${lat},${lng}`);

    return success(res, {
      statusCode: 200,
      message: 'Coordinates saved.',
      data: {
        id: loc.id,
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        geocoded_at: loc.geocoded_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/locations/address
// Access: super_admin
// Body: { name: string, parent_id: uuid (zone), latitude?: number, longitude?: number }
//
// Creates a new address-type location (a PG / hostel) under an existing
// zone. Coordinates are optional at create — a PG can be created first
// and pinned later from the coordinate picker (the "Needs pin" filter
// exists exactly for this workflow).
//
// Guards:
//   • name is required, 2–150 chars, whitespace-normalized
//   • parent_id must reference an existing zone-type location
//   • duplicate name under the same zone is rejected (409) so the
//     admin doesn't accidentally create two "Rehmat PG" rows next to
//     each other. Rejection is scoped per-zone so a same-name PG can
//     legitimately exist in a different zone.
//   • coord validation reuses parseOptionalCoords — same rules as the
//     existing setCoordinates endpoint.
// ---------------------------------------------------------------------------
const createAddress = async (req, res, next) => {
  try {
    const { name: rawName, parent_id } = req.body || {};

    const name = cleanName(rawName);
    if (!name) {
      return error(res, {
        statusCode: 400,
        message: 'name is required (2–150 characters).',
      });
    }

    if (!parent_id) {
      return error(res, { statusCode: 400, message: 'parent_id (zone) is required.' });
    }

    const parent = await Location.findByPk(parent_id);
    if (!parent) {
      return error(res, { statusCode: 404, message: 'Zone (parent_id) not found.' });
    }
    if (parent.type !== 'zone') {
      return error(res, {
        statusCode: 400,
        message: 'parent_id must reference a location of type zone.',
      });
    }

    // Per-zone uniqueness — case-insensitive substring guard so
    // "Rehmat PG" vs "rehmat pg" doesn't slip through.
    const duplicate = await Location.findOne({
      where: {
        parent_id: parent.id,
        type: 'address',
        name: { [Op.like]: name },
        is_active: true,
      },
    });
    if (duplicate) {
      return error(res, {
        statusCode: 409,
        message: `A PG named "${name}" already exists under ${parent.name}.`,
      });
    }

    const coords = parseOptionalCoords(req.body || {});
    if (coords.error) {
      return error(res, { statusCode: 400, message: coords.error });
    }

    const row = await Location.create({
      name,
      type: 'address',
      parent_id: parent.id,
      is_active: true,
      latitude:    coords.provided ? coords.lat : null,
      longitude:   coords.provided ? coords.lng : null,
      geocoded_at: coords.provided ? new Date() : null,
    });

    logger.info(
      `[locations] super_admin=${req.auth.id} created PG "${row.name}" (${row.id}) under zone "${parent.name}"` +
      (coords.provided ? ` with pin ${coords.lat},${coords.lng}` : ' (unpinned)')
    );

    return success(res, {
      statusCode: 201,
      message: 'PG created.',
      data: {
        id:          row.id,
        name:        row.name,
        type:        row.type,
        parent_id:   row.parent_id,
        parent:      { id: parent.id, name: parent.name },
        latitude:    row.latitude,
        longitude:   row.longitude,
        geocoded_at: row.geocoded_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/locations/:id
// Access: super_admin
// Body: { name?: string, parent_id?: uuid }
//
// Rename a PG and/or move it to a different zone. Restricted to
// type='address' — city/area/zone are structural and only get seeded.
// Coord updates continue to go through PATCH /:id/coordinates so the
// endpoint contracts stay narrow.
//
// Same duplicate-name-per-zone guard as create.
// ---------------------------------------------------------------------------
const updateAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name: rawName, parent_id: newParentId } = req.body || {};

    const row = await Location.findByPk(id);
    if (!row) return error(res, { statusCode: 404, message: 'Location not found.' });
    if (row.type !== 'address') {
      return error(res, {
        statusCode: 403,
        message: `Only addresses can be edited here. "${row.name}" is a ${row.type}.`,
      });
    }

    // Resolve the eventual parent + name for the duplicate check.
    let nextName = row.name;
    let nextParentId = row.parent_id;
    let nextParent = null;

    if (rawName !== undefined) {
      const cleaned = cleanName(rawName);
      if (!cleaned) {
        return error(res, {
          statusCode: 400,
          message: 'name must be 2–150 characters after trimming.',
        });
      }
      nextName = cleaned;
    }

    if (newParentId !== undefined && newParentId !== null && newParentId !== row.parent_id) {
      const parent = await Location.findByPk(newParentId);
      if (!parent) return error(res, { statusCode: 404, message: 'New zone (parent_id) not found.' });
      if (parent.type !== 'zone') {
        return error(res, {
          statusCode: 400,
          message: 'parent_id must reference a location of type zone.',
        });
      }
      nextParentId = parent.id;
      nextParent = parent;
    }

    // Only run the duplicate check if something actually changed.
    if (nextName !== row.name || nextParentId !== row.parent_id) {
      const duplicate = await Location.findOne({
        where: {
          parent_id: nextParentId,
          type: 'address',
          name: { [Op.like]: nextName },
          is_active: true,
          id: { [Op.ne]: row.id },
        },
      });
      if (duplicate) {
        return error(res, {
          statusCode: 409,
          message: `Another PG named "${nextName}" already exists in that zone.`,
        });
      }
    }

    row.name = nextName;
    row.parent_id = nextParentId;
    await row.save();

    // Load parent for the response (nextParent may be null if only name changed).
    const parentRow = nextParent || await Location.findByPk(row.parent_id, {
      attributes: ['id', 'name'],
    });

    logger.info(`[locations] super_admin=${req.auth.id} updated PG ${row.id} → name="${row.name}", parent=${row.parent_id}`);

    return success(res, {
      statusCode: 200,
      message: 'PG updated.',
      data: {
        id:          row.id,
        name:        row.name,
        type:        row.type,
        parent_id:   row.parent_id,
        parent:      parentRow ? { id: parentRow.id, name: parentRow.name } : null,
        latitude:    row.latitude,
        longitude:   row.longitude,
        geocoded_at: row.geocoded_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/locations/:id
// Access: super_admin
//
// Removes a PG. To keep referential integrity for users linked to the
// PG (and any historical PollResponse rows that snapshotted the zone by
// name), we SOFT-delete: set is_active=false. The listing endpoints
// already filter on is_active so the row disappears from every UI
// surface but the row itself and its FK targets remain intact.
//
// Guards:
//   • Only type='address' rows are deletable (never zones).
//   • Refuses if ≥1 active user is still linked to this PG — that
//     would leave those users pointing at a hidden row. Admin must
//     reassign or delete those users first, or use ?force=true to
//     acknowledge the state.
//   • Idempotent — deleting an already-inactive row returns 200 with
//     a "already removed" message instead of throwing.
// ---------------------------------------------------------------------------
const deleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const force = String(req.query.force || '').toLowerCase() === 'true';

    const row = await Location.findByPk(id);
    if (!row) return error(res, { statusCode: 404, message: 'Location not found.' });
    if (row.type !== 'address') {
      return error(res, {
        statusCode: 403,
        message: `Only addresses (PGs) can be deleted. "${row.name}" is a ${row.type}.`,
      });
    }
    if (!row.is_active) {
      return success(res, {
        statusCode: 200,
        message: 'PG was already removed.',
        data: { id: row.id, name: row.name },
      });
    }

    // Guard: block if active users are still linked here.
    // status='deleted' users are anonymized soft-deletes elsewhere in
    // the app — we ignore them since they're not going to log in and
    // wouldn't notice the missing PG.
    const linkedUserCount = await User.count({
      where: {
        location_id: row.id,
        status: { [Op.ne]: 'deleted' },
      },
    });
    if (linkedUserCount > 0 && !force) {
      return error(res, {
        statusCode: 409,
        message:
          `${linkedUserCount} user${linkedUserCount === 1 ? '' : 's'} still ` +
          `assigned to "${row.name}". Reassign them first (or pass ?force=true to delete anyway; ` +
          `they will still be linked to a hidden PG until you update their profile).`,
      });
    }

    row.is_active = false;
    await row.save();

    logger.info(
      `[locations] super_admin=${req.auth.id} soft-deleted PG "${row.name}" (${row.id})` +
      (linkedUserCount > 0 ? ` — force=true, ${linkedUserCount} user(s) still linked` : '')
    );

    return success(res, {
      statusCode: 200,
      message: 'PG removed.',
      data: {
        id: row.id,
        name: row.name,
        linked_user_count_at_delete: linkedUserCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getLocations,
  getLocationsNeedingCoordinates,
  listAllAddresses,
  setCoordinates,
  createAddress,
  updateAddress,
  deleteAddress,
};
