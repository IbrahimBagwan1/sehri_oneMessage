'use strict';

/**
 * DEPRECATED — do not import this file.
 *
 * It used to export VALID_ZONES, a frozen list of four zone keys. That froze
 * the community at four zones, and worse, the vote path matched against it by
 * slugifying each zone's display name — so "Girls Accommodation" slugified to
 * `girls_accommodation`, never matched the list's `girls`, and nobody in that
 * zone could vote at all.
 *
 * Zones now live in the database. A zone's identity is locations.zone_key,
 * assigned once at creation and never rewritten, and the list is read through
 * services/zoneRegistry.js:
 *
 *     const zoneRegistry = require('../services/zoneRegistry');
 *     const keys = await zoneRegistry.zoneKeys();
 *     const ok   = await zoneRegistry.isValidZoneKey(key);
 *     const opts = await zoneRegistry.zoneOptions();   // [{ key, label, id }]
 *
 * The file is kept as a signpost rather than deleted, because "where did
 * VALID_ZONES go?" is the obvious question on encountering the old name in
 * git history.
 */

module.exports = {};
