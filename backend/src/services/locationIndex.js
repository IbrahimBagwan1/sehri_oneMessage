'use strict';

/**
 * locationIndex.js — the whole location tree, in memory, briefly cached.
 *
 * WHY
 * "Which zone is this PG in?" and "where is the nearest pinned coordinate?"
 * were answered by walking parent_id one `findByPk` at a time — and asked
 * once per vote, per PG, per stop and per ETA recompute. Generating a
 * night's delivery run cost several queries per PG; the ETA service did it
 * on every GPS push. The tree is a few hundred rows at most, so one SELECT
 * and an in-memory walk answers every one of those questions.
 *
 * The same walk had also been written six times (resolveZone, the admin
 * controller, the tracking controller, the broadcast controller, the
 * notification service, zoneScope). They now share this.
 *
 * FRESHNESS
 * Cached for CACHE_MS and dropped immediately by invalidate(), which every
 * location write in locationController calls. Another server instance may
 * lag by up to CACHE_MS after an admin edits the tree; no decision here is
 * sensitive to a minute of lag.
 */

const db = require('../models');

const CACHE_MS = 60 * 1000;
const MAX_HOPS = 10; // guard against an accidental cycle in parent_id

let cache = null;
let cachedAt = 0;
let inFlight = null;

const invalidate = () => {
  cache = null;
  cachedAt = 0;
};

const build = async () => {
  const rows = await db.Location.findAll({
    attributes: [
      'id', 'name', 'type', 'parent_id', 'zone_key', 'is_active',
      'is_sandbox', 'latitude', 'longitude',
    ],
    raw: true,
  });
  const byId = new Map();
  const children = new Map();
  for (const r of rows) {
    byId.set(r.id, r);
    if (r.parent_id) {
      if (!children.has(r.parent_id)) children.set(r.parent_id, []);
      children.get(r.parent_id).push(r.id);
    }
  }
  return { byId, children };
};

/** The index; built once per CACHE_MS, with concurrent callers sharing one build. */
const load = async () => {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  if (!inFlight) {
    inFlight = build()
      .then((idx) => { cache = idx; cachedAt = Date.now(); return idx; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
};

const get = async (id) => (id ? (await load()).byId.get(id) || null : null);

/** Nearest ancestor-or-self of type 'zone', or null. */
const zoneOf = async (locationId) => {
  const { byId } = await load();
  let current = byId.get(locationId);
  for (let hops = 0; current && hops < MAX_HOPS; hops += 1) {
    if (current.type === 'zone') return current;
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return null;
};

/**
 * The shared delivery coordinate for a location: itself if pinned, else the
 * nearest pinned ancestor. Every member at one PG resolves to the same
 * point, which is what makes them all see the same route and ETA.
 *
 * @returns {{ lat, lng, source_location_id, source_location_type, source_location_name } | null}
 */
const destinationOf = async (locationId) => {
  const { byId } = await load();
  let current = byId.get(locationId);
  for (let hops = 0; current && hops < MAX_HOPS; hops += 1) {
    if (current.latitude != null && current.longitude != null) {
      return {
        lat: Number(current.latitude),
        lng: Number(current.longitude),
        source_location_id: current.id,
        source_location_type: current.type,
        source_location_name: current.name,
      };
    }
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return null;
};

/** rootId plus every descendant id. activeOnly skips retired branches. */
const descendantIds = async (rootId, { activeOnly = true } = {}) => {
  const { byId, children } = await load();
  const out = new Set();
  if (!rootId) return out;
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    if (out.has(id)) continue;
    const row = byId.get(id);
    // raw rows carry MySQL's 0/1 for booleans, hence the truthiness test.
    if (id !== rootId && activeOnly && row && !row.is_active) continue;
    out.add(id);
    for (const child of children.get(id) || []) queue.push(child);
  }
  return out;
};

module.exports = {
  load,
  get,
  zoneOf,
  destinationOf,
  descendantIds,
  invalidate,
};
