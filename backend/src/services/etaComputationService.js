'use strict';

/**
 * etaComputationService.js — recompute live delivery ETAs whenever the
 * assigned rider pushes a new position.
 *
 * Called (fire-and-forget) from trackingController.pushLocation. Never
 * throws — a failure to compute ETAs must not fail the location push.
 *
 * Cost control:
 *   • THROTTLE by movement — skip if the rider hasn't moved
 *     ETA_RECOMPUTE_MIN_METERS since the last successful recompute.
 *   • THROTTLE by time — but never wait longer than
 *     ETA_RECOMPUTE_MAX_SECONDS between recomputes even if standing
 *     still (so the "arriving in X min" ticks down as time passes).
 *   • BATCH — dedupe destinations by (lat,lng) and send ONE Distance
 *     Matrix call per recompute (many destinations, one call).
 *   • DEGRADE — destinations whose PG has no coordinates are silently
 *     skipped. Users at un-geocoded PGs just don't get an ETA.
 *
 * Side effects per recompute:
 *   • Updates poll_responses.current_eta_minutes + current_eta_updated_at
 *     for every recipient of today's delivery in the rider's zone.
 *   • Fires an Expo push exactly once per recipient when their ETA
 *     first drops to ≤ PROXIMITY_ETA_MINUTES (guarded by
 *     proximity_notified_at).
 *   • Broadcasts a zone-wide `rider_position` socket event so the
 *     user map moves in real time.
 *   • Broadcasts a per-user `eta_update` socket event.
 */

const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');
const googleMapsService = require('./googleMapsService');
const expoPushService = require('./expoPushService');
const notificationService = require('./notificationService');
const socketService = require('./socketService');
const { resolveZone } = require('../utils/resolveZone');

const { Poll, PollResponse, User, Rider, Location, DeliveryStop } = db;

// ---------------------------------------------------------------------------
// Config — env-overridable, sensible defaults for a community-scale run.
// ---------------------------------------------------------------------------
const PROXIMITY_ETA_MINUTES = Number.parseInt(process.env.PROXIMITY_ETA_MINUTES, 10) || 5;
const RECOMPUTE_MIN_METERS  = Number.parseInt(process.env.ETA_RECOMPUTE_MIN_METERS,  10) || 100;
const RECOMPUTE_MIN_SECONDS = Number.parseInt(process.env.ETA_RECOMPUTE_MIN_SECONDS, 10) || 30;
const RECOMPUTE_MAX_SECONDS = Number.parseInt(process.env.ETA_RECOMPUTE_MAX_SECONDS, 10) || 120;

// ---------------------------------------------------------------------------
// In-process rider state — cheap throttling without a Redis round-trip.
// For a single-process backend this is fine; if you scale horizontally
// later, move to Redis. Structure: riderId → { lat, lng, at (Date) }
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

/** Today in IST — matches the poll-lookup pattern used elsewhere. */
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// ---------------------------------------------------------------------------
// Decide whether to skip this recompute.
//
// Skip only if BOTH:
//   • rider has moved less than RECOMPUTE_MIN_METERS, AND
//   • less than RECOMPUTE_MIN_SECONDS have passed since last recompute.
// Force a recompute if RECOMPUTE_MAX_SECONDS have passed — so the ETA
// keeps ticking down even when the rider is stopped at a light.
// ---------------------------------------------------------------------------
const shouldSkipRecompute = (riderId, lat, lng) => {
  const last = lastRecomputeByRider.get(riderId);
  if (!last) return false;
  const secSince = (Date.now() - last.at) / 1000;
  if (secSince >= RECOMPUTE_MAX_SECONDS) return false;
  const moved = haversineMeters({ lat: last.lat, lng: last.lng }, { lat, lng });
  return moved < RECOMPUTE_MIN_METERS && secSince < RECOMPUTE_MIN_SECONDS;
};

/**
 * Given the rider's new position, load their zone, deliverable
 * destinations for today, and update every ETA in one batched Distance
 * Matrix call.
 *
 * @param {object} rider           — Sequelize Rider instance
 * @param {number} lat             — rider's new latitude
 * @param {number} lng             — rider's new longitude
 */
const updateETAsForRider = async (rider, lat, lng) => {
  try {
    if (!rider) return;

    // `rider` is the CAPTAIN — the owner of the stop list. The position is
    // the team's tracked device, which may be the helper's phone. The
    // throttle is keyed on the captain so a pair does not recompute twice
    // as often as a solo rider.
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

    const poll = await Poll.findOne({ where: { date: todayIST() } });
    if (!poll) return;

    // MULTI-RIDER: this rider drives ETAs for whichever PGs
    // delivery_stops assigns to them. We derive the eligible
    // PollResponses from that stop list, so two riders in the same
    // zone each recompute ETAs only for their own users.
    //
    // Legacy fallback: if no stops have been generated yet (single-
    // rider pre-multi-rider flow), fall back to poll.assigned_rider_id
    // + the old zone-based predicate.
    const myStops = await DeliveryStop.findAll({
      where: { poll_id: poll.id, rider_id: rider.id, status: 'pending' },
      attributes: ['id', 'location_id'],
    });

    let inZoneResponses;
    if (myStops.length > 0) {
      const stopLocationIds = new Set(myStops.map((s) => s.location_id));
      // Load every deliverable response whose user is at one of our
      // assigned PGs. One DB call per recompute regardless of rider count.
      const responses = await PollResponse.findAll({
        where: {
          poll_id: poll.id,
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
          {
            model: User,
            as: 'user',
            attributes: ['id', 'name', 'fcm_token', 'location_id'],
          },
        ],
      });
      inZoneResponses = responses.filter((r) => stopLocationIds.has(r.user?.location_id));
    } else {
      // Legacy path — single-rider flow via poll.assigned_rider_id.
      if (poll.assigned_rider_id !== rider.id) return;

      const responses = await PollResponse.findAll({
        where: {
          poll_id: poll.id,
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
          {
            model: User,
            as: 'user',
            attributes: ['id', 'name', 'fcm_token', 'location_id'],
          },
        ],
      });
      // Responses whose member has erased their account carry no
      // location, so there is nothing to compute an ETA to. The
      // multi-rider path above already drops them via the
      // `stopLocationIds.has(r.user?.location_id)` filter.
      inZoneResponses = responses.filter((r) => r.user);
      if (rider.zone_location_id) {
        const scoped = [];
        for (const r of inZoneResponses) {
          const zone = await resolveZone(r.user.location_id, db);
          if (zone && zone.id === rider.zone_location_id) scoped.push(r);
        }
        inZoneResponses = scoped;
      }
    }

    if (inZoneResponses.length === 0) return;

    // Resolve each user's address-level location (with coords) and dedupe.
    // Multiple residents at the same PG share one destination — one
    // matrix cell instead of N.
    const destByKey = new Map(); // "lat,lng" → { lat, lng, responseIds:[] }
    const responsesWithoutCoords = [];
    for (const r of inZoneResponses) {
      const loc = await Location.findByPk(r.user.location_id);
      if (!loc || loc.latitude == null || loc.longitude == null) {
        responsesWithoutCoords.push(r);
        continue;
      }
      const key = `${loc.latitude},${loc.longitude}`;
      if (!destByKey.has(key)) {
        destByKey.set(key, {
          lat: Number(loc.latitude),
          lng: Number(loc.longitude),
          responseIds: [],
        });
      }
      destByKey.get(key).responseIds.push(r.id);
    }

    if (destByKey.size === 0) {
      logger.warn(`[eta] Rider ${rider.id}: no destinations with coordinates to compute`);
      return;
    }

    if (!googleMapsService.isConfigured()) {
      logger.warn('[eta] GOOGLE_MAPS_API_KEY missing — skipping ETA compute');
      return;
    }

    // One HTTP call per destination (Directions gives us both the ETA
    // AND the polyline — cheaper than distanceMatrix for our purposes
    // since we need to draw the road-following route on the map anyway).
    //
    // SHARED-DESTINATION DEDUP:
    //   destByKey already collapsed multiple users at the same PG into a
    //   single destination entry. So Directions is called ONCE per PG per
    //   recompute — 10 users at the same hostel = 1 API call, not 10 —
    //   and the resulting polyline is shared among all their eta_update
    //   emits. This is what guarantees they see the identical map view.
    const CHUNK = 25;
    const dests = Array.from(destByKey.values());
    const etaByResponseId = new Map();
    const routeByResponseId = new Map();

    for (let i = 0; i < dests.length; i += CHUNK) {
      const slice = dests.slice(i, i + CHUNK);
      await Promise.all(
        slice.map(async (dest) => {
          try {
            const dir = await googleMapsService.directions({
              origin: { lat, lng },
              destination: { lat: dest.lat, lng: dest.lng },
              mode: 'driving',
            });
            let etaMin = null;
            let path = null;
            if (dir && dir.durationSeconds != null) {
              etaMin = Math.max(0, Math.round(dir.durationSeconds / 60));
              // Convert Directions' [[lat,lng], ...] to the
              // {latitude, longitude}[] shape the RN client expects.
              if (Array.isArray(dir.path) && dir.path.length >= 2) {
                path = dir.path.map(([la, ln]) => ({ latitude: la, longitude: ln }));
              }
            } else {
              // Directions failed or hit a rate limit — fall back to
              // distanceMatrix for the number, drop the polyline.
              const dm = await googleMapsService.distanceMatrix({
                origin: { lat, lng },
                destination: { lat: dest.lat, lng: dest.lng },
                mode: 'driving',
              });
              etaMin = dm.durationSeconds != null
                ? Math.max(0, Math.round(dm.durationSeconds / 60))
                : null;
            }
            for (const responseId of dest.responseIds) {
              etaByResponseId.set(responseId, etaMin);
              if (path) routeByResponseId.set(responseId, path);
            }
          } catch (err) {
            // Silent per-destination failure — others still succeed.
            logger.warn(`[eta] directions/distanceMatrix failed for ${dest.lat},${dest.lng}: ${err.message}`);
          }
        })
      );
    }

    // Persist + emit + push in one pass.
    const now = new Date();
    const pushes = [];
    for (const r of inZoneResponses) {
      const etaMin = etaByResponseId.get(r.id);
      if (etaMin == null) continue;

      const proximityHit =
        etaMin <= PROXIMITY_ETA_MINUTES && r.proximity_notified_at == null;

      await r.update({
        current_eta_minutes: etaMin,
        current_eta_updated_at: now,
        ...(proximityHit ? { proximity_notified_at: now } : {}),
      });

      // Per-user socket event so their track screen shows the new ETA
      // instantly, without waiting for the wider zone broadcast.
      // `route` is the shared road-following polyline for this user's
      // destination — dedup guaranteed by routeByResponseId being keyed
      // off destByKey, so every user at the same PG receives the same
      // array here (React Native compares by ref elsewhere, but each
      // socket payload is a fresh JSON per user).
      try {
        socketService.emitEtaUpdate(r.user.id, {
          poll_id: poll.id,
          response_id: r.id,
          eta_minutes: etaMin,
          route: routeByResponseId.get(r.id) || null,
          rider: { id: rider.id, name: rider.name, latitude: lat, longitude: lng },
          at: now.toISOString(),
        });
      } catch (_) { /* socket not initialised in tests — ignore */ }

      if (proximityHit && r.user?.fcm_token) {
        pushes.push({
          to: r.user.fcm_token,
          title: 'Your Sehri is close',
          body:
            etaMin <= 1
              ? 'Your rider is arriving now.'
              : `Your rider is arriving in about ${etaMin} minutes.`,
          data: {
            type: 'delivery_arrival',
            poll_id: poll.id,
            response_id: r.id,
            eta_minutes: etaMin,
          },
        });
      }
    }

    // NOTE: we deliberately do NOT emit rider_position here anymore.
    // trackingController.pushLocation now broadcasts every push
    // unconditionally, so users' maps update even when this service
    // short-circuits (throttled window, no destinations with coords,
    // etc.). Emitting again here would be a duplicate event on the
    // slow path.

    if (pushes.length > 0) {
      // Fire-and-forget — do not block the rest of the response.
      // forgetTokens is passed so a token that turns out to be dead is
       // cleared here too, not only on the paths that go through
       // notificationService. Without it the proximity run would keep
       // pushing to uninstalled apps forever.
      expoPushService.sendPushBatch(pushes, notificationService.forgetTokens)
        .then((r) => logger.info(`[eta] proximity pushes: sent=${r.sent} dropped=${r.dropped}`))
        .catch((err) => logger.warn(`[eta] push batch failed: ${err.message}`));
    }

    lastRecomputeByRider.set(rider.id, { lat, lng, at: Date.now() });

    logger.info(
      `[eta] captain=${rider.id} ` +
      `destinations=${destByKey.size} recipients=${inZoneResponses.length} ` +
      `noCoords=${responsesWithoutCoords.length} pushes=${pushes.length}`
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
 *
 * Emitted to the captain's run room rather than a zone room: a captain may
 * cover several zones, and residents of the other captains' zones have no
 * business being told anything about this one.
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
  PROXIMITY_ETA_MINUTES,
};
