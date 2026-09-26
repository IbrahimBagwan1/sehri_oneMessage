'use strict';

/**
 * deliveryTeamService.js — the one place that answers "who is on which team,
 * and which zones do they cover".
 *
 * THE MODEL
 * A delivery team is one Captain, who drives, plus zero or one Helper, who
 * rides along and hands parcels to people. The captain owns a set of zones;
 * every PG in those zones is theirs for the whole run. Another captain's
 * zones are a separate run with a separate route and a separate stop list,
 * and the two never touch.
 *
 * Today one captain covers every zone. That is not a special case handled by
 * a different branch — it is the same code path with one row per zone in
 * captain_zone_assignments, all pointing at the same person. Nothing here
 * counts captains or assumes an upper bound.
 *
 * WHY ROLES ARE DERIVED, NOT STORED
 * A rider is a captain if they have zone assignments, and a helper if some
 * captain points at them. Storing that as a column would create a second
 * source of truth: change someone's assignments without remembering to
 * change their role and the two disagree, with no way to tell which is
 * right. Deriving costs one join and cannot drift.
 *
 * WHOSE PHONE IS TRACKED
 * When a team has a helper, the helper's device is the tracked one. The
 * captain is driving; the helper is the one with a free hand, walking to
 * the door, marking stops. A solo captain is tracked directly.
 *
 * There is one exception, and it is about a dead battery rather than a
 * preference: if the tracked device has not reported for STALE_FIX_MS while
 * the other team member has a fresher fix, the fresher one is used. Both
 * members may push; only the answer here decides what residents see, so it
 * never flip-flops between two live devices.
 */

const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');
const { resolveZone } = require('../utils/resolveZone');

const { Rider, Location, CaptainZoneAssignment } = db;

// A tracked device that has not reported in this long is treated as off the
// air, and the other team member's fix is used if it is fresher. Three
// minutes is six missed updates at the 30s cadence — long enough that a
// tunnel or a stalled upload does not trigger it, short enough that a phone
// that died at the start of a street does not freeze the map for the rest
// of the run.
const STALE_FIX_MS = 3 * 60 * 1000;

const RIDER_PUBLIC_ATTRS = [
  'id', 'name', 'phone', 'zone_location_id', 'helper_rider_id',
  'latitude', 'longitude', 'current_address', 'eta_minutes',
  'status', 'is_active', 'updated_at',
];

/** Shape a Rider row for an API response. Never leaks the password hash. */
const publicRider = (r) => (r ? {
  id: r.id,
  name: r.name,
  phone: r.phone,
  status: r.status,
  is_active: r.is_active,
  latitude: r.latitude,
  longitude: r.longitude,
  current_address: r.current_address,
  eta_minutes: r.eta_minutes,
} : null);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every zone a captain covers, as Location rows, ordered by name.
 * Empty array for a rider who is not a captain.
 */
const zonesForCaptain = async (captainId, { transaction } = {}) => {
  if (!captainId) return [];
  const rows = await CaptainZoneAssignment.findAll({
    where: { captain_rider_id: captainId },
    include: [{ model: Location, as: 'zone', attributes: ['id', 'name', 'zone_key', 'is_active'] }],
    transaction,
  });
  return rows
    .map((r) => r.zone)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
};

/** The captain responsible for a zone, or null when nobody covers it. */
const captainForZone = async (zoneId, { transaction } = {}) => {
  if (!zoneId) return null;
  const row = await CaptainZoneAssignment.findOne({
    where: { zone_location_id: zoneId },
    include: [{ model: Rider, as: 'captain' }],
    transaction,
  });
  return row?.captain || null;
};

/**
 * The captain responsible for any location — a PG, an area, a zone itself.
 * Walks up the parent chain to the zone first, exactly as the vote-time
 * zone snapshot does, so a PG and its residents always resolve the same way.
 */
const captainForLocation = async (locationId, { transaction } = {}) => {
  if (!locationId) return null;
  const zone = await resolveZone(locationId, db);
  if (!zone) return null;
  return captainForZone(zone.id, { transaction });
};

/**
 * Resolve a rider's place in the team structure.
 *
 * Returns:
 *   role       'captain' | 'helper' | 'unassigned'
 *   captain    the Rider who owns the stops (self, for a captain)
 *   helper     the Rider riding along, or null
 *   zones      the captain's zones (empty for 'unassigned')
 *   isTracked  whether THIS rider's device is the one residents follow
 *
 * 'unassigned' is a real, valid state, not an error: a rider who has been
 * created but not yet put on the roster, or a captain whose zones were
 * handed to someone else. They see an empty route rather than a crash.
 */
const resolveTeam = async (riderId, { transaction } = {}) => {
  if (!riderId) {
    return { role: 'unassigned', captain: null, helper: null, zones: [], isTracked: false };
  }

  const me = await Rider.findByPk(riderId, { transaction });
  if (!me) {
    return { role: 'unassigned', captain: null, helper: null, zones: [], isTracked: false };
  }

  // Am I somebody's helper? The unique index on helper_rider_id guarantees
  // at most one answer, so findOne is exact rather than arbitrary.
  const myCaptain = await Rider.findOne({
    where: { helper_rider_id: me.id },
    transaction,
  });

  if (myCaptain) {
    const zones = await zonesForCaptain(myCaptain.id, { transaction });
    return {
      role: 'helper',
      captain: myCaptain,
      helper: me,
      zones,
      // A helper exists, so the helper is the tracked device — and that is me.
      isTracked: true,
    };
  }

  const zones = await zonesForCaptain(me.id, { transaction });
  const helper = me.helper_rider_id
    ? await Rider.findByPk(me.helper_rider_id, { transaction })
    : null;

  if (zones.length === 0 && !helper) {
    return { role: 'unassigned', captain: null, helper: null, zones: [], isTracked: false };
  }

  return {
    role: 'captain',
    captain: me,
    helper,
    zones,
    // A captain with a helper is not the tracked device; the helper is.
    isTracked: !helper,
  };
};

/**
 * The rider id whose delivery_stops rows represent this rider's work.
 *
 * Stops are always keyed to the captain. A helper reads and writes their
 * captain's stops — that shared state is what makes them one team rather
 * than two people who happen to be on the same bike.
 *
 * Returns null for a rider with no team, so callers return an empty route
 * instead of silently falling back to somebody else's.
 */
const stopOwnerIdFor = async (riderId, { transaction } = {}) => {
  const team = await resolveTeam(riderId, { transaction });
  return team.captain?.id || null;
};

/**
 * Which of a team's two devices residents should follow.
 *
 * Prefers the helper when there is one. Falls back to the captain when the
 * helper has no fix at all, or has gone quiet for STALE_FIX_MS while the
 * captain is still reporting. Pure function of the two rows — no clock
 * skew between calls, no state to keep.
 */
const trackedRider = (captain, helper) => {
  if (!helper) return captain || null;
  if (!captain) return helper;

  const fixAt = (r) => {
    if (r?.latitude == null || r?.longitude == null) return null;
    const t = r.updated_at || r.updatedAt;
    return t ? new Date(t).getTime() : null;
  };
  const hAt = fixAt(helper);
  const cAt = fixAt(captain);

  if (hAt == null) return cAt == null ? helper : captain;
  if (cAt == null) return helper;

  const helperStale = Date.now() - hAt > STALE_FIX_MS;
  return helperStale && cAt > hAt ? captain : helper;
};

/**
 * The status of a TEAM, which is not the same as the status of either
 * person in it.
 *
 * A helper can start the round while the captain has not tapped anything
 * yet — the helper is holding the phone, after all. Reading the captain's
 * own row would then tell a resident "rider is idle" while the bike is
 * visibly moving across their map.
 *
 *   done        the captain has closed the round. Only the captain can:
 *               a helper signing off early has not ended anything.
 *   delivering  either of them is out.
 *   otherwise   the captain's own status.
 */
const teamStatus = (captain, helper) => {
  if (!captain) return 'idle';
  if (captain.status === 'done') return 'done';
  if (captain.status === 'delivering' || helper?.status === 'delivering') return 'delivering';
  return captain.status;
};

/**
 * The full roster, for the admin configuration screen.
 *
 *   captains         every rider who covers at least one zone, or has a
 *                    helper, with their zones and helper
 *   uncovered_zones  active zones with no captain — these produce orphaned
 *                    PGs at assign time, so they are surfaced loudly
 *   available        riders who are neither captain nor helper, i.e. who
 *                    can be picked as a helper
 */
const getRoster = async () => {
  const [riders, zones, assignments] = await Promise.all([
    Rider.findAll({ order: [['created_at', 'ASC']] }),
    Location.findAll({
      where: { type: 'zone', is_active: true },
      attributes: ['id', 'name', 'zone_key'],
      order: [['name', 'ASC']],
    }),
    CaptainZoneAssignment.findAll(),
  ]);

  const byId = new Map(riders.map((r) => [r.id, r]));
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const zonesByCaptain = new Map();
  const captainByZone = new Map();
  for (const a of assignments) {
    if (!zonesByCaptain.has(a.captain_rider_id)) zonesByCaptain.set(a.captain_rider_id, []);
    zonesByCaptain.get(a.captain_rider_id).push(a.zone_location_id);
    captainByZone.set(a.zone_location_id, a.captain_rider_id);
  }

  const helperIds = new Set(riders.map((r) => r.helper_rider_id).filter(Boolean));

  const captains = riders
    .filter((r) => zonesByCaptain.has(r.id) || r.helper_rider_id)
    .map((r) => {
      const zoneIds = zonesByCaptain.get(r.id) || [];
      return {
        ...publicRider(r),
        zones: zoneIds
          .map((id) => zoneById.get(id))
          .filter(Boolean)
          .map((z) => ({ id: z.id, name: z.name, zone_key: z.zone_key }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        // A zone row that has been deactivated still holds its assignment;
        // count it so the numbers add up, but it delivers to nobody.
        stale_zone_count: zoneIds.filter((id) => !zoneById.has(id)).length,
        helper: publicRider(byId.get(r.helper_rider_id) || null),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const uncovered = zones
    .filter((z) => !captainByZone.has(z.id))
    .map((z) => ({ id: z.id, name: z.name, zone_key: z.zone_key }));

  // Eligible to be picked as a helper: not already a helper, and not a
  // captain (a captain has their own route; they cannot also be riding on
  // somebody else's).
  const available = riders
    .filter((r) => !helperIds.has(r.id) && !zonesByCaptain.has(r.id) && !r.helper_rider_id)
    .map(publicRider);

  return {
    captains,
    uncovered_zones: uncovered,
    available_riders: available,
    // Every zone with who holds it, so the admin zone picker can show an
    // already-taken zone as locked and NAME the captain holding it —
    // answering the overlap question before it is asked, instead of after
    // it is refused.
    all_zones: zones.map((z) => {
      const holderId = captainByZone.get(z.id) || null;
      return {
        id: z.id,
        name: z.name,
        zone_key: z.zone_key,
        captain_rider_id: holderId,
        captain_name: holderId ? (byId.get(holderId)?.name || null) : null,
      };
    }),
  };
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Replace a captain's zone set with exactly `zoneIds`.
 *
 * Whole-set semantics, not add/remove, because that is what the admin screen
 * shows: a multi-select of every zone with this captain's ticked. Sending
 * the resulting set makes the write idempotent and removes the "I ticked
 * three and two applied" class of bug entirely.
 *
 * Throws { status, message } on a conflict rather than silently stealing a
 * zone from another captain. Reassigning is deliberately a two-step action
 * (unassign there, assign here) so it cannot happen by mis-tapping a
 * checkbox at 3am.
 */
const setCaptainZones = async (captainId, zoneIds) => {
  const wanted = Array.from(new Set((zoneIds || []).filter(Boolean)));

  return db.sequelize.transaction(async (t) => {
    const captain = await Rider.findByPk(captainId, { transaction: t });
    if (!captain) {
      throw Object.assign(new Error('Rider not found.'), { status: 404 });
    }

    // A helper cannot also be a captain — they would owe two routes at once.
    const ridesFor = await Rider.findOne({
      where: { helper_rider_id: captainId },
      attributes: ['id', 'name'],
      transaction: t,
    });
    if (ridesFor && wanted.length > 0) {
      throw Object.assign(
        new Error(`${captain.name} is currently ${ridesFor.name}'s helper. Remove them as a helper before giving them zones of their own.`),
        { status: 409 }
      );
    }

    if (wanted.length > 0) {
      const zones = await Location.findAll({
        where: { id: { [Op.in]: wanted }, type: 'zone' },
        attributes: ['id', 'name', 'is_active'],
        transaction: t,
      });
      if (zones.length !== wanted.length) {
        throw Object.assign(
          new Error('One or more of those locations is not an existing zone.'),
          { status: 400 }
        );
      }
      const inactive = zones.filter((z) => !z.is_active);
      if (inactive.length > 0) {
        throw Object.assign(
          new Error(`Cannot assign an inactive zone: ${inactive.map((z) => z.name).join(', ')}.`),
          { status: 422 }
        );
      }

      // The unique index would catch this too, but a raw duplicate-key error
      // reaches the admin as "Validation error" and names nobody. Checking
      // first lets us say which zone and which captain.
      const taken = await CaptainZoneAssignment.findAll({
        where: {
          zone_location_id: { [Op.in]: wanted },
          captain_rider_id: { [Op.ne]: captainId },
        },
        include: [
          { model: Rider, as: 'captain', attributes: ['id', 'name'] },
          { model: Location, as: 'zone', attributes: ['id', 'name'] },
        ],
        transaction: t,
      });
      if (taken.length > 0) {
        const detail = taken
          .map((a) => `${a.zone?.name || 'A zone'} is ${a.captain?.name || 'another captain'}'s`)
          .join('; ');
        throw Object.assign(
          new Error(`${detail}. A zone can only have one captain — unassign it there first.`),
          { status: 409, code: 'ZONE_ALREADY_ASSIGNED' }
        );
      }
    }

    const existing = await CaptainZoneAssignment.findAll({
      where: { captain_rider_id: captainId },
      transaction: t,
    });
    const have = new Set(existing.map((a) => a.zone_location_id));
    const toAdd = wanted.filter((z) => !have.has(z));
    const toRemove = existing.filter((a) => !wanted.includes(a.zone_location_id));

    if (toRemove.length > 0) {
      await CaptainZoneAssignment.destroy({
        where: { id: { [Op.in]: toRemove.map((a) => a.id) } },
        transaction: t,
      });
    }
    if (toAdd.length > 0) {
      await CaptainZoneAssignment.bulkCreate(
        toAdd.map((zoneId) => ({ captain_rider_id: captainId, zone_location_id: zoneId })),
        { transaction: t }
      );
    }

    // Losing every zone while still holding a helper would leave a team with
    // nothing to deliver. Release the helper so they return to the available
    // pool instead of being invisibly attached to a captain with no route.
    if (wanted.length === 0 && captain.helper_rider_id) {
      await captain.update({ helper_rider_id: null }, { transaction: t });
    }

    logger.info(
      `[teams] captain=${captainId} zones set to ${wanted.length} `
      + `(+${toAdd.length} -${toRemove.length})`
    );
    return { added: toAdd.length, removed: toRemove.length, total: wanted.length };
  });
};

/**
 * Give a captain a helper, swap the one they have, or remove it with null.
 *
 * Every rule here exists because the alternative is a real operational mess
 * rather than a theoretical one:
 *   • nobody helps themselves — a one-person team with two roles
 *   • a helper rides one bike — enforced by the unique index, checked here
 *     so the message names who already has them
 *   • a captain with zones cannot be demoted to helper — their PGs would
 *     silently stop being delivered
 *   • only a captain can have a helper — a helper for a rider with no route
 *     is two people with nothing to do
 */
const setCaptainHelper = async (captainId, helperId) => {
  return db.sequelize.transaction(async (t) => {
    const captain = await Rider.findByPk(captainId, { transaction: t });
    if (!captain) {
      throw Object.assign(new Error('Captain not found.'), { status: 404 });
    }

    const zoneCount = await CaptainZoneAssignment.count({
      where: { captain_rider_id: captainId },
      transaction: t,
    });
    if (zoneCount === 0 && helperId) {
      throw Object.assign(
        new Error(`${captain.name} has no zones yet. Assign zones before adding a helper — otherwise the pair has nothing to deliver.`),
        { status: 422 }
      );
    }

    if (!helperId) {
      await captain.update({ helper_rider_id: null }, { transaction: t });
      logger.info(`[teams] captain=${captainId} helper removed`);
      return { helper: null };
    }

    if (helperId === captainId) {
      throw Object.assign(
        new Error('A captain cannot be their own helper.'),
        { status: 422 }
      );
    }

    const helper = await Rider.findByPk(helperId, { transaction: t });
    if (!helper) {
      throw Object.assign(new Error('That rider does not exist.'), { status: 404 });
    }
    if (!helper.is_active) {
      throw Object.assign(
        new Error(`${helper.name} is off duty. Bring them back on duty first.`),
        { status: 422 }
      );
    }

    const helperOwnZones = await CaptainZoneAssignment.count({
      where: { captain_rider_id: helperId },
      transaction: t,
    });
    if (helperOwnZones > 0) {
      throw Object.assign(
        new Error(`${helper.name} is a captain with ${helperOwnZones} zone${helperOwnZones === 1 ? '' : 's'} of their own. Move those zones to another captain before making them a helper.`),
        { status: 409 }
      );
    }
    if (helper.helper_rider_id) {
      throw Object.assign(
        new Error(`${helper.name} has a helper of their own, so they are running a team. Remove that first.`),
        { status: 409 }
      );
    }

    const alreadyHelping = await Rider.findOne({
      where: { helper_rider_id: helperId, id: { [Op.ne]: captainId } },
      attributes: ['id', 'name'],
      transaction: t,
    });
    if (alreadyHelping) {
      throw Object.assign(
        new Error(`${helper.name} is already ${alreadyHelping.name}'s helper. One person, one bike.`),
        { status: 409, code: 'HELPER_ALREADY_ASSIGNED' }
      );
    }

    await captain.update({ helper_rider_id: helperId }, { transaction: t });
    logger.info(`[teams] captain=${captainId} helper set to ${helperId}`);
    return { helper: publicRider(helper) };
  });
};

module.exports = {
  STALE_FIX_MS,
  publicRider,
  zonesForCaptain,
  captainForZone,
  captainForLocation,
  resolveTeam,
  stopOwnerIdFor,
  trackedRider,
  teamStatus,
  getRoster,
  setCaptainZones,
  setCaptainHelper,
};
