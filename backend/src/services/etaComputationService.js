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
const socketService = require('./socketService');
const { resolveZone } = require('../utils/resolveZone');

const { Poll, PollResponse, User, Rider, Location } = db;

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
    if (!rider || rider.status !== 'delivering') return;

    if (shouldSkipRecompute(rider.id, lat, lng)) return;

    // Only the assigned rider for today's poll drives ETAs.
    const poll = await Poll.findOne({ where: { date: todayIST() } });
    if (!poll || poll.assigned_rider_id !== rider.id) return;

    // Load deliverable responses — anyone who voted yes and wasn't
    // cancelled by an approved dont_want special case, plus approved
    // want special cases. Matches getDeliveryList's SQL predicate.
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

    if (responses.length === 0) return;

    // Filter to the rider's zone (unless the rider is unzoned).
    let inZoneResponses = responses;
    if (rider.zone_location_id) {
      inZoneResponses = [];
      for (const r of responses) {
        const zone = await resolveZone(r.user.location_id, db);
        if (zone && zone.id === rider.zone_location_id) inZoneResponses.push(r);
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
      expoPushService.sendPushBatch(pushes)
        .then((r) => logger.info(`[eta] proximity pushes: sent=${r.sent} dropped=${r.dropped}`))
        .catch((err) => logger.warn(`[eta] push batch failed: ${err.message}`));
    }

    lastRecomputeByRider.set(rider.id, { lat, lng, at: Date.now() });

    logger.info(
      `[eta] rider=${rider.id} zone=${rider.zone_location_id || 'all'} ` +
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
 * Called when a rider stops delivering. Clears the throttle state and
 * emits a zone event so open user maps can hide the marker cleanly.
 */
const onRiderStopped = (rider) => {
  if (!rider) return;
  lastRecomputeByRider.delete(rider.id);
  if (rider.zone_location_id) {
    try {
      socketService.emitRiderPosition(rider.zone_location_id, {
        rider_id: rider.id,
        name: rider.name,
        status: 'done',
        at: new Date().toISOString(),
      });
    } catch (_) { /* noop */ }
  }
};

module.exports = {
  updateETAsForRider,
  onRiderStopped,
  PROXIMITY_ETA_MINUTES,
};
