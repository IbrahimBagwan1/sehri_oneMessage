'use strict';

/**
 * zoneScope.js — shared helpers for zone-scoped queries across controllers.
 *
 * The locations table is a self-referencing tree (city → area → zone → address).
 * Any zone-scoped list query needs to:
 *   1. Eager-load the user's full location ancestor chain in one JOIN.
 *   2. Walk that chain in memory to find the nearest ancestor of type='zone'.
 *   3. Filter results to those whose zone.id matches the calling admin's
 *      zone_location_id (super_admin sees everything).
 *
 * These helpers factor that pattern out so donations, feedback, and any
 * future zone-scoped list controllers stay DRY.
 *
 * For a one-off zone lookup by a bare location_id, use resolveZone() from
 * ../utils/resolveZone.js — it hits the DB directly (fine for single-row
 * lookups in vote/create paths).
 */

const db = require('../models');

const { Location } = db;

/**
 * Build a nested Sequelize include chain that eager-loads the location plus
 * `depth` levels of parent ancestors in one JOIN. The result can be walked
 * in memory with resolveZoneFromLoaded() — no per-user DB queries.
 *
 * @param {number} depth  — how many parent hops to eager-load (default 5).
 * @param {string} as     — the target relation name on the parent model.
 *                          Defaults to 'location' to match the User model.
 * @returns {object}      — Sequelize include descriptor.
 */
const buildLocationInclude = (depth = 5, as = 'location') => {
  let include = null;
  for (let i = 0; i < depth; i += 1) {
    include = {
      model: Location,
      as: 'parent',
      required: false,
      attributes: ['id', 'name', 'type', 'parent_id'],
      ...(include ? { include: [include] } : {}),
    };
  }
  return {
    model: Location,
    as,
    required: false,
    attributes: ['id', 'name', 'type', 'parent_id'],
    include: include ? [include] : [],
  };
};

/**
 * Walk an eager-loaded Location instance's `parent` chain in memory to find
 * the nearest ancestor of type='zone'. Returns null if none is found or the
 * chain is missing.
 *
 * @param {object|null} location — Location instance with nested `parent`.
 * @returns {object|null}        — The zone-type Location, or null.
 */
const resolveZoneFromLoaded = (location) => {
  let current = location;
  let hops = 0;
  const MAX_HOPS = 10; // guard against accidental cycles

  while (current && current.type !== 'zone' && hops < MAX_HOPS) {
    current = current.parent || null;
    hops += 1;
  }

  return current && current.type === 'zone' ? current : null;
};

/**
 * Convenience: given a list of rows that each carry an eager-loaded
 * `user.location` chain, filter down to only rows whose resolved zone
 * matches the given zoneLocationId. Super_admins should skip this and
 * see everything.
 *
 * @param {Array}  rows           — Sequelize rows with a `user.location` chain.
 * @param {string} zoneLocationId — the admin's zone_location_id (UUID).
 * @returns {Array}               — filtered rows.
 */
const filterRowsToZone = (rows, zoneLocationId) => {
  return rows.filter((row) => {
    const zone = resolveZoneFromLoaded(row.user?.location);
    return zone && zone.id === zoneLocationId;
  });
};

module.exports = {
  buildLocationInclude,
  resolveZoneFromLoaded,
  filterRowsToZone,
};
