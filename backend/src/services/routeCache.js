'use strict';

/**
 * routeCache.js — a small TTL cache in front of paid Google Maps calls.
 *
 * Directions and Distance Matrix are billed per request. Several screens ask
 * the same question many times a minute — every resident at one PG opening
 * the tracking screen, the rider screen refetching after each tap — and the
 * answer barely changes in that time. This keeps one answer per question
 * for a short TTL and collapses concurrent identical requests into one call.
 *
 * Keys round coordinates to three decimal places (~110 m), which is well
 * inside the precision a route or an ETA-in-minutes can use, so a rider
 * idling at a light does not generate a fresh key on every GPS jitter.
 *
 * In-memory and per process. That is the right trade here: a miss costs one
 * API call, and a shared cache would add infrastructure to save cents.
 */

const MAX_ENTRIES = 2000;

const store = new Map();     // key → { value, expiresAt }
const inFlight = new Map();  // key → Promise

const round = (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(3) : 'x');

/** Build a cache key; {lat,lng} parts are rounded, everything else stringified. */
const key = (...parts) => parts
  .map((p) => (p && typeof p === 'object' && 'lat' in p ? `${round(p.lat)},${round(p.lng)}` : String(p)))
  .join('|');

const prune = () => {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
  // Still over budget: drop the oldest insertions (Map preserves order).
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
};

/**
 * Return the cached value for `k`, or compute it with `producer`, cache it
 * for `ttlMs`, and return it. A producer that throws is not cached.
 */
const remember = async (k, ttlMs, producer) => {
  const hit = store.get(k);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (inFlight.has(k)) return inFlight.get(k);

  const p = Promise.resolve()
    .then(producer)
    .then((value) => {
      store.set(k, { value, expiresAt: Date.now() + ttlMs });
      prune();
      return value;
    })
    .finally(() => inFlight.delete(k));
  inFlight.set(k, p);
  return p;
};

/** Store a value directly (used by the ETA service to prime per-PG answers). */
const set = (k, value, ttlMs) => {
  store.set(k, { value, expiresAt: Date.now() + ttlMs });
  prune();
};

/** Read without producing. */
const peek = (k) => {
  const hit = store.get(k);
  return hit && hit.expiresAt > Date.now() ? hit.value : undefined;
};

const clear = () => { store.clear(); inFlight.clear(); };

module.exports = { key, remember, set, peek, clear };
