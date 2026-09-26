'use strict';

const db = require('../models');

const { Location } = db;

/**
 * zoneRegistry.js — the list of zones, read from the database.
 *
 * This replaces constants/zones.js, which froze the community at four zones
 * and identified them by slugifying their display names. Two consequences of
 * that, both real:
 *
 *   • A zone whose name did not slugify to one of the four hardcoded keys
 *     could not accept votes at all. "Girls Accommodation" slugified to
 *     girls_accommodation, the list held girls, and every vote from that
 *     zone was rejected.
 *   • Renaming a zone silently orphaned its history, because the key each
 *     past vote was stored under no longer matched the live name.
 *
 * So identity now lives in locations.zone_key: assigned once when the zone is
 * created, unique, and never rewritten. The display name is free to change.
 *
 * CACHING — zones change perhaps a handful of times in the lifetime of the
 * app, and the vote path reads this on every request. A short TTL keeps that
 * cheap without anyone having to remember to invalidate; every mutation in
 * locationController calls invalidate() anyway, so the TTL is only a backstop
 * for changes made outside the app (a SQL console, a migration).
 */

const TTL_MS = 60 * 1000;

let cache = null;
let cachedAt = 0;

/** Drop the cache. Called by every write path that touches zones. */
const invalidate = () => {
  cache = null;
  cachedAt = 0;
};

/**
 * Turn a display name into a candidate key: lowercase, non-alphanumerics
 * collapsed to underscores. Exported because the create path needs it before
 * the row exists.
 */
const slugify = (name) =>
  String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'zone';

/**
 * A key not yet taken by any zone, derived from `name`.
 * Suffixes _2, _3 … on collision, so two zones may share a display name
 * without sharing an identity.
 */
const nextAvailableKey = async (name) => {
  const base = slugify(name);
  const rows = await Location.findAll({
    where: { type: 'zone' },
    attributes: ['zone_key'],
  });
  const taken = new Set(rows.map((r) => r.zone_key).filter(Boolean));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}_${n}`.slice(0, 50);
    if (!taken.has(candidate)) return candidate;
  }
  // 999 zones sharing one name is not a real scenario; fail loudly if it is.
  throw new Error(`Could not derive a unique zone_key from "${name}"`);
};

/** Every active zone: [{ id, name, key }], ordered by name. */
const listZones = async () => {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;

  const rows = await Location.findAll({
    where: { type: 'zone', is_active: true },
    attributes: ['id', 'name', 'zone_key'],
    order: [['name', 'ASC']],
  });
  cache = rows
    .filter((r) => r.zone_key)
    .map((r) => ({ id: r.id, name: r.name, key: r.zone_key }));
  cachedAt = Date.now();
  return cache;
};

/** Just the keys — the shape the old VALID_ZONES constant had. */
const zoneKeys = async () => (await listZones()).map((z) => z.key);

/** Display name for a key, falling back to the key itself for retired zones. */
const labelFor = async (zoneKey) => {
  const found = (await listZones()).find((z) => z.key === zoneKey);
  return found ? found.name : zoneKey;
};

/**
 * [{ key, label }] for every active zone — handed to clients so screens stop
 * carrying their own hardcoded key→label maps.
 */
const zoneOptions = async () =>
  (await listZones()).map((z) => ({ key: z.key, label: z.name, id: z.id }));

/** Is this key a live zone? */
const isValidZoneKey = async (zoneKey) => (await zoneKeys()).includes(zoneKey);

module.exports = {
  listZones,
  zoneKeys,
  zoneOptions,
  labelFor,
  isValidZoneKey,
  nextAvailableKey,
  slugify,
  invalidate,
};
