'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

const { Location } = db;

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
      where: { type: 'address' },
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

module.exports = {
  getLocations,
  getLocationsNeedingCoordinates,
  listAllAddresses,
  setCoordinates,
};
