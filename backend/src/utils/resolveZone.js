'use strict';

/**
 * Given any location_id (a zone itself, or a PG under one), return the
 * nearest ancestor-or-self of type 'zone', or null if there is none.
 *
 * Kept as a thin wrapper so existing call sites keep their signature; the
 * walk itself now happens in memory — see services/locationIndex.js for why
 * it no longer issues a query per hop. The second argument is accepted and
 * ignored for the same reason.
 *
 * Returns a plain object ({ id, name, type, parent_id, zone_key, ... }).
 */
const resolveZone = async (locationId /* , db */) => {
  if (!locationId) return null;
  // Required lazily: this util is loaded by models-adjacent code at boot.
  const locationIndex = require('../services/locationIndex');
  return locationIndex.zoneOf(locationId);
};

module.exports = { resolveZone };
