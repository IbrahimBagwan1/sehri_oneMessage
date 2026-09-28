'use strict';

/**
 * etaComputationService.js — recompute live delivery ETAs as the team moves.
 *
 * Called (fire-and-forget) from trackingController.pushLocation. Never
 * throws — a failure to compute ETAs must not fail the location push.
 *
 * ONE ROUTE, NOT ONE CALL PER PG (release audit)
 * The previous version asked Google Directions for a separate route from
 * the rider to EVERY pending PG, on every recompute — about every 18 seconds
 * while riding. Thirty PGs made that ~100 paid calls a minute per team, and
 * the answers were wrong in a way residents noticed: the 20th PG on the
 * route, sitting two streets away, was told "arriving in 3 minutes" (and
 * sent the proximity push) while the rider still had nineteen doors to go.
 *
 * Now there is ONE Directions call per recompute, through the pending stops
 * in the order the rider will actually visit them (delivery_stops.sort_order,
 * which is itself Google-optimised). Each stop's ETA is the sum of the legs
 * before it plus a handover allowance per earlier stop, so "arriving in 5
 * minutes" means five minutes along the real route. Each resident's map
 * route is the road path up to their own stop.
 *
 * Cost control:
 *   • one request per recompute per team (≤ MAX_ROUTE_STOPS stops)
 *   • never more often than RECOMPUTE_MIN_SECONDS; after that, only when
 *     the team has moved RECOMPUTE_MIN_METERS or RECOMPUTE_MAX_SECONDS has
 *     passed (so a countdown still ticks while stopped at a light)
 *   • each PG's latest answer is kept in routeCache, so GET /tracking/eta
 *     answers from it instead of making its own call
 *
 * Side effects per recompute:
 *   • poll_responses.current_eta_minutes / current_eta_updated_at
 *   • one Expo push per recipient the first time their ETA drops to
 *     PROXIMITY_ETA_MINUTES or less (guarded by proximity_notified_at)
 *   • a per-user `eta_update` socket event with the ETA and their route
 */

const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');
const googleMapsService = require('./googleMapsService');
const expoPushService = require('./expoPushService');
const notificationService = require('./notificationService');
const socketService = require('./socketService');
const locationIndex = require('./locationIndex');
const pollCalendar = require('./pollCalendar');
const routeCache = require('./routeCache');

const { PollResponse, User, Rider, DeliveryStop } = db;

// ---------------------------------------------------------------------------
// Config — env-overridable, sensible defaults for a community-scale run.
// ---------------------------------------------------------------------------
const intEnv = (name, fallback) => Number.parseInt(process.env[name], 10) || fallback;

const PROXIMITY_ETA_MINUTES = intEnv('PROXIMITY_ETA_MINUTES', 5);
const RECOMPUTE_MIN_METERS  = intEnv('ETA_RECOMPUTE_MIN_METERS', 100);
const RECOMPUTE_MIN_SECONDS = intEnv('ETA_RECOMPUTE_MIN_SECONDS', 60);
const RECOMPUTE_MAX_SECONDS = intEnv('ETA_RECOMPUTE_MAX_SECONDS', 180);
// Time spent at each earlier stop handing parcels over, added to the ETA of
// every stop after it.
const STOP_DWELL_SECONDS    = intEnv('ETA_STOP_DWELL_SECONDS', 90);
// Directions accepts 25 waypoints plus origin and destination. Stops beyond
// this keep their previous ETA until the route shortens.
const MAX_ROUTE_STOPS = 25;
// Per-resident route payloads are downsampled to keep socket frames small.
const MAX_ROUTE_POINTS = 250;
// How long a PG's computed answer is served to GET /tracking/eta.
const ETA_CACHE_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------
// In-process throttle state, keyed by captain: captainId → { lat, lng, at }.
// Per process by design — a second instance recomputing occasionally costs
// one extra request, not a correctness problem.
// ---------------------------------------------------------------------------
const lastRecomputeByRider = new Map();

/** Haversine distance between two coords, in meters. */
const haversineMeters = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const shouldSkipRecompute = (riderId, lat, lng) => {
  const last = lastRecomputeByRider.get(riderId);
  if (!last) return false;
  const secSince = (Date.now() - last.at) / 1000;
  if (secSince < RECOMPUTE_MIN_SECONDS) return true;
  if (secSince >= RECOMPUTE_MAX_SECONDS) return false;
  return haversineMeters({ lat: last.lat, lng: last.lng }, { lat, lng }) < RECOMPUTE_MIN_METERS;
};

/** Keep at most `max` points, always including the last one. */
const downsample = (points, max) => {
  if (!Array.isArray(points) || points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max - 1; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
};

const DELIVERABLE = {
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
};

/** Cache key for a PG's latest computed ETA — read by GET /tracking/eta. */
const etaCacheKey = (captainId, locationId) => routeCache.key('eta', captainId, locationId);

/**
 * Recompute ETAs for a captain's pending stops from the team's position.
 *
 * @param {object} rider — the CAPTAIN (owner of the stop list)
 * @param {number} lat   — the tracked device's latitude
 * @param {number} lng   — the tracked device's longitude
 */
const updateETAsForRider = async (rider, lat, lng) => {
  try {
    if (!rider) return;

    if (rider.status !== 'delivering') {
      // A captain whose own row says idle can still have a helper out
      // delivering, so check the team before giving up on the run.
      const helperOut = rider.helper_rider_id
        ? await Rider.findOne({
            where: { id: rider.helper_rider_id, status: 'delivering' },
            attributes: ['id'],
          })
        : null;
      if (!helperOut) return;
    }

    if (shouldSkipRecompute(rider.id, lat, lng)) return;
    if (!googleMapsService.isConfigured()) return;

    const poll = await pollCalendar.getDeliveryPoll();
    if (!poll) return;

    const stops = await DeliveryStop.findAll({
      where: { poll_id: poll.id, rider_id: rider.id, status: 'pending' },
      attributes: ['id', 'location_id', 'sort_order'],
      order: [
        [db.sequelize.literal('sort_order IS NULL'), 'ASC'],
        ['sort_order', 'ASC'],
        ['created_at', 'ASC'],
      ],
    });
    if (stops.length === 0) return;

    // Stops we can route to, in visit order.
    const routable = [];
    for (const s of stops) {
      if (routable.length >= MAX_ROUTE_STOPS) break;
      const dest = await locationIndex.destinationOf(s.location_id);
      if (dest) routable.push({ stop: s, dest });
    }
    if (routable.length === 0) {
      logger.warn(`[eta] captain=${rider.id}: no pending stop has map coordinates`);
      return;
    }

    // Record the attempt before the call, so a slow or failing Directions
    // request is not retried on every GPS push while it is outstanding.
    lastRecomputeByRider.set(rider.id, { lat, lng, at: Date.now() });

    const last = routable[routable.length - 1];
    const dir = await googleMapsService.directions({
      origin: { lat, lng },
      destination: { lat: last.dest.lat, lng: last.dest.lng },
      waypoints: routable.slice(0, -1).map((r) => ({ lat: r.dest.lat, lng: r.dest.lng })),
      optimizeWaypoints: false, // keep the rider's actual visit order
      withLegPaths: true,
    });
    if (!dir || !Array.isArray(dir.legs) || dir.legs.length < routable.length) {
      logger.warn(`[eta] captain=${rider.id}: Directions returned no usable route`);
      return;
    }

    // Cumulative ETA and road path for each stop, in visit order.
    const perLocation = new Map(); // location_id → { etaMin, route }
    let seconds = 0;
    let path = [{ latitude: lat, longitude: lng }];
    routable.forEach((r, i) => {
      const leg = dir.legs[i];
      seconds += (leg.durationSeconds || 0) + (i > 0 ? STOP_DWELL_SECONDS : 0);
      path = path.concat((leg.path || []).map(([la, ln]) => ({ latitude: la, longitude: ln })));
      const etaMin = Math.max(0, Math.round(seconds / 60));
      const route = downsample(path, MAX_ROUTE_POINTS);
      perLocation.set(r.stop.location_id, { etaMin, route });
      routeCache.set(
        etaCacheKey(rider.id, r.stop.location_id),
        { eta_minutes: etaMin, route, at: new Date().toISOString(), origin: { lat, lng } },
        ETA_CACHE_MS
      );
    });

    // Everyone expecting a packet at one of those stops.
    const responses = await PollResponse.findAll({
      where: { poll_id: poll.id, ...DELIVERABLE },
      attributes: ['id', 'user_id', 'proximity_notified_at'],
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'fcm_token', 'location_id'],
        where: { location_id: { [Op.in]: [...perLocation.keys()] } },
        required: true,
      }],
    });
    if (responses.length === 0) return;

    const now = new Date();
    const idsByEta = new Map();   // etaMin → [responseId]
    const proximityIds = [];
    const pushes = [];

    for (const r of responses) {
      const { etaMin, route } = perLocation.get(r.user.location_id);
      if (!idsByEta.has(etaMin)) idsByEta.set(etaMin, []);
      idsByEta.get(etaMin).push(r.id);

      const proximityHit = etaMin <= PROXIMITY_ETA_MINUTES && r.proximity_notified_at == null;
      if (proximityHit) {
        proximityIds.push(r.id);
        if (r.user.fcm_token) {
          pushes.push({
            to: r.user.fcm_token,
            title: 'Your Sehri is close',
            body: etaMin <= 1
              ? 'Your rider is arriving now.'
              : `Your rider is arriving in about ${etaMin} minutes.`,
            data: {
              type: 'delivery_arrival',
              poll_id: poll.id,
              response_id: r.id,
              eta_minutes: etaMin,
              route: '/(user)/track',
            },
          });
        }
      }

      try {
        socketService.emitEtaUpdate(r.user.id, {
          poll_id: poll.id,
          response_id: r.id,
          eta_minutes: etaMin,
          route,
          rider: { id: rider.id, name: rider.name, latitude: lat, longitude: lng },
          at: now.toISOString(),
        });
      } catch (_) { /* socket not initialised in tests — ignore */ }
    }

    // One UPDATE per distinct ETA value rather than one per resident.
    for (const [etaMin, ids] of idsByEta) {
      await PollResponse.update(
        { current_eta_minutes: etaMin, current_eta_updated_at: now },
        { where: { id: { [Op.in]: ids } } }
      );
    }
    if (proximityIds.length) {
      // Conditional on still being null, so two instances racing on the
      // same push cannot both claim it.
      await PollResponse.update(
        { proximity_notified_at: now },
        { where: { id: { [Op.in]: proximityIds }, proximity_notified_at: null } }
      );
    }

    if (pushes.length > 0) {
      // Dead tokens are cleared on the way out, same as every other send.
      expoPushService.sendPushBatch(pushes, notificationService.forgetTokens)
        .then((r) => logger.info(`[eta] proximity pushes: sent=${r.sent} dropped=${r.dropped}`))
        .catch((err) => logger.warn(`[eta] push batch failed: ${err.message}`));
    }

    logger.info(
      `[eta] captain=${rider.id} stops=${routable.length}/${stops.length} `
      + `recipients=${responses.length} pushes=${pushes.length}`
    );
  } catch (err) {
    // Absolutely must never throw — this runs as a fire-and-forget
    // side-effect of a hot-path location push.
    logger.error(`[eta] updateETAsForRider failed: ${err.stack || err.message}`);
  }
};

/**
 * The captain's run is over. Clears the throttle state and tells that
 * team's watchers to drop the marker.
 */
const onTeamStopped = (captain) => {
  if (!captain) return;
  lastRecomputeByRider.delete(captain.id);
  try {
    socketService.emitTeamPosition(captain.id, {
      captain_rider_id: captain.id,
      rider_id: captain.id,
      name: captain.name,
      status: 'done',
      at: new Date().toISOString(),
    });
  } catch (_) { /* noop */ }
};

module.exports = {
  // Named for the team, since a pair shares one stop list and one ETA run.
  updateETAsForTeam: updateETAsForRider,
  onTeamStopped,
  // Old names, same functions. Anything still calling these keeps working.
  updateETAsForRider,
  onRiderStopped: onTeamStopped,
  etaCacheKey,
  PROXIMITY_ETA_MINUTES,
};
