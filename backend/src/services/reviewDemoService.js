'use strict';

/**
 * reviewDemoService.js — accounts for App Store and Play Store reviewers.
 *
 * THE PROBLEM
 * Signing up needs an SMS OTP to an Indian mobile number and then an admin's
 * approval. A reviewer in Cupertino or Dublin can do neither, and "we could
 * not sign in" is a guaranteed rejection (App Review 2.1, Play "App access").
 *
 * THE SHAPE OF THE ANSWER
 * Off unless REVIEW_DEMO_ENABLED=true. When on:
 *
 *   • A DEMO MEMBER signs in with REVIEW_DEMO_PHONE + REVIEW_DEMO_PASSWORD.
 *   • A DEMO RIDER (optional) signs in on the rider screen with
 *     REVIEW_DEMO_RIDER_PHONE + REVIEW_DEMO_PASSWORD, so the reviewer can see
 *     the one feature that uses location, and the permission prompt for it.
 *   • The demo phone accepts REVIEW_DEMO_OTP instead of an SMS, so the
 *     sign-up and forgot-password screens can be exercised end to end. No
 *     SMS is ever sent to that number, and no other number accepts the code.
 *
 * WHAT THE DEMO ACCOUNTS CAN SEE
 * Both live in a sandbox branch of the location tree (locations.is_sandbox):
 *   • hidden from the public location picker, so real members never land
 *     in it and the reviewer never sees the real PG list's neighbours;
 *   • left out of zone statistics, so a reviewer's vote never changes what
 *     the kitchen cooks;
 *   • left out of real delivery runs, so no real rider is sent to it and the
 *     demo rider is never sent to a real door;
 *   • given its own zone chat room, so the demo member talks to nobody but
 *     the (always-present) super admins, who can see what reviewers post.
 *
 * SELF-HEALING
 * Reviewers are asked to try account deletion, and they do. The next
 * reviewer must still be able to sign in, so a sign-in with the documented
 * password recreates the demo account (and re-applies the documented
 * password, the sandbox location and approval) if anything has moved.
 */

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');

const { Location, User, Rider, CaptainZoneAssignment } = db;

const SANDBOX = Object.freeze({
  city:    'App Review Sandbox',
  region:  'Sandbox Region',
  area:    'Sandbox Area',
  zone:    'App Review',
  zoneKey: 'app_review_sandbox',
  pg:      'Demo PG',
  // Central Bangalore — a real road network, so the demo rider's route and
  // ETA render the way they do for members.
  lat:     12.9716,
  lng:     77.5946,
});

const DEMO_MEMBER_NAME = 'App Review (demo)';
const DEMO_RIDER_NAME = 'App Review Rider (demo)';

const isEnabled = () => process.env.REVIEW_DEMO_ENABLED === 'true';
const demoPhone = () => (isEnabled() ? process.env.REVIEW_DEMO_PHONE || null : null);
const demoRiderPhone = () => (isEnabled() ? process.env.REVIEW_DEMO_RIDER_PHONE || null : null);

const isDemoPhone = (phone) => !!phone && phone === demoPhone();
const isDemoRiderPhone = (phone) => !!phone && phone === demoRiderPhone();
const isDemoPassword = (password) =>
  isEnabled() && typeof password === 'string' && password === process.env.REVIEW_DEMO_PASSWORD;

// ---------------------------------------------------------------------------
// Sandbox membership — read on hot paths, so cached briefly.
// ---------------------------------------------------------------------------
const CACHE_MS = 60 * 1000;
let sandboxCache = { ids: new Set(), zoneIds: new Set(), at: 0 };

const invalidate = () => { sandboxCache = { ids: new Set(), zoneIds: new Set(), at: 0 }; };

const loadSandbox = async () => {
  if (Date.now() - sandboxCache.at < CACHE_MS) return sandboxCache;
  const rows = await Location.findAll({
    where: { is_sandbox: true },
    attributes: ['id', 'type'],
    raw: true,
  });
  sandboxCache = {
    ids: new Set(rows.map((r) => r.id)),
    zoneIds: new Set(rows.filter((r) => r.type === 'zone').map((r) => r.id)),
    at: Date.now(),
  };
  return sandboxCache;
};

/** Every sandbox location id (city down to PG). */
const sandboxLocationIds = async () => (await loadSandbox()).ids;
/** Sandbox zone ids only. */
const sandboxZoneIds = async () => (await loadSandbox()).zoneIds;
const isSandboxLocation = async (locationId) =>
  !!locationId && (await loadSandbox()).ids.has(locationId);

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/** Find or create one sandbox location row. */
const ensureLocation = async (fields, extra = {}) => {
  const existing = await Location.findOne({
    where: { is_sandbox: true, type: fields.type, name: fields.name },
  });
  if (existing) return existing;
  return Location.create({ ...fields, ...extra, is_sandbox: true, is_active: true });
};

/** The sandbox branch: city → region → area → zone → PG. Idempotent. */
const ensureSandbox = async () => {
  const city = await ensureLocation({ name: SANDBOX.city, type: 'city', parent_id: null });
  const region = await ensureLocation({ name: SANDBOX.region, type: 'region', parent_id: city.id });
  const area = await ensureLocation({ name: SANDBOX.area, type: 'area', parent_id: region.id });

  let zone = await Location.findOne({ where: { is_sandbox: true, type: 'zone' } });
  if (!zone) {
    // The zone_key is fixed rather than derived, so it can never collide
    // with (or be mistaken for) a real zone's key.
    const clash = await Location.findOne({ where: { zone_key: SANDBOX.zoneKey } });
    zone = await Location.create({
      name: SANDBOX.zone,
      type: 'zone',
      parent_id: area.id,
      zone_key: clash ? null : SANDBOX.zoneKey,
      is_sandbox: true,
      is_active: true,
    });
  }

  const pg = await ensureLocation(
    { name: SANDBOX.pg, type: 'address', parent_id: zone.id },
    { latitude: SANDBOX.lat, longitude: SANDBOX.lng, geocoded_at: new Date() }
  );

  invalidate();
  return { city, region, area, zone, pg };
};

/** Bring the chat side in line: the sandbox zone's room and its members. */
const syncSandboxChat = (zoneId) => {
  // Required lazily: chatGroupSync pulls in socketService, which pulls in
  // models, and this file is loaded by controllers at boot.
  const chatGroupSync = require('./chatGroupSync');
  chatGroupSync.ensureZoneGroups()
    .then(() => chatGroupSync.syncInBackground([zoneId], 'review sandbox'))
    .catch((err) => logger.warn(`[review-demo] sandbox chat sync failed: ${err.message}`));
};

/**
 * Make sure the demo member exists and can sign in with the documented
 * password. Called on a sign-in attempt that used that password.
 */
const ensureDemoMember = async () => {
  const phone = demoPhone();
  if (!phone) return null;

  const { zone, pg } = await ensureSandbox();
  const hash = await bcrypt.hash(process.env.REVIEW_DEMO_PASSWORD, 10);

  let user = await User.scope('withPassword').findOne({ where: { phone } });
  if (!user) {
    user = await User.create({
      name: DEMO_MEMBER_NAME,
      phone,
      password: hash,
      gender: 'male',
      occupation: 'others',
      city: 'Bangalore',
      location_id: pg.id,
      address: 'App Review sandbox — not a real address',
      status: 'approved',
      is_phone_verified: true,
    });
    logger.info('[review-demo] demo member created');
  } else {
    const passwordOk = await bcrypt.compare(process.env.REVIEW_DEMO_PASSWORD, user.password);
    const updates = {};
    if (!passwordOk) updates.password = hash;
    if (user.status !== 'approved') updates.status = 'approved';
    if (user.location_id !== pg.id) updates.location_id = pg.id;
    if (Object.keys(updates).length) {
      await user.update(updates);
      logger.info(`[review-demo] demo member repaired (${Object.keys(updates).join(', ')})`);
    }
  }

  syncSandboxChat(zone.id);
  return user;
};

/**
 * Make sure the demo rider exists, is active, and captains the sandbox zone.
 */
const ensureDemoRider = async () => {
  const phone = demoRiderPhone();
  if (!phone) return null;

  const { zone } = await ensureSandbox();
  const hash = await bcrypt.hash(process.env.REVIEW_DEMO_PASSWORD, 10);

  let rider = await Rider.scope('withPassword').findOne({ where: { phone } });
  if (!rider) {
    rider = await Rider.create({
      name: DEMO_RIDER_NAME,
      phone,
      password: hash,
      zone_location_id: zone.id,
      is_active: true,
    });
    logger.info('[review-demo] demo rider created');
  } else {
    const passwordOk = await bcrypt.compare(process.env.REVIEW_DEMO_PASSWORD, rider.password);
    const updates = {};
    if (!passwordOk) updates.password = hash;
    if (!rider.is_active) updates.is_active = true;
    if (Object.keys(updates).length) await rider.update(updates);
  }

  // The sandbox zone's captain. The unique index on zone_location_id means
  // this can only ever point at one rider; if a super admin reassigned it by
  // hand, it is reclaimed for the demo rider.
  const assignment = await CaptainZoneAssignment.findOne({ where: { zone_location_id: zone.id } });
  if (!assignment) {
    await CaptainZoneAssignment.create({ captain_rider_id: rider.id, zone_location_id: zone.id });
  } else if (assignment.captain_rider_id !== rider.id) {
    await assignment.update({ captain_rider_id: rider.id });
  }
  return rider;
};

/**
 * Tonight's stop for the demo rider, created on demand.
 *
 * Real runs never include the sandbox (see assignDeliveryRun), so the demo
 * rider would otherwise have an empty route and nothing to demonstrate.
 * One stop at the demo PG is enough to show the route, the ETA, and
 * marking a delivery done.
 */
const ensureDemoStop = async (poll, captainId) => {
  if (!poll || !captainId) return;
  const { pg } = await ensureSandbox();
  await db.DeliveryStop.findOrCreate({
    where: { poll_id: poll.id, rider_id: captainId, location_id: pg.id },
    defaults: {
      poll_id: poll.id,
      rider_id: captainId,
      location_id: pg.id,
      packet_count: 1,
      status: 'pending',
      sort_order: 1,
    },
  });
};

/** Is this rider the sandbox captain (and nothing else)? */
const isSandboxCaptain = async (riderId) => {
  if (!riderId) return false;
  const zones = await CaptainZoneAssignment.findAll({
    where: { captain_rider_id: riderId },
    attributes: ['zone_location_id'],
    raw: true,
  });
  if (zones.length === 0) return false;
  const sandbox = await sandboxZoneIds();
  return zones.every((z) => sandbox.has(z.zone_location_id));
};

/** Sandbox location ids as a Sequelize NOT IN clause (or {} when empty). */
const excludeSandboxLocations = async (column = 'location_id') => {
  const ids = [...(await sandboxLocationIds())];
  return ids.length ? { [column]: { [Op.notIn]: ids } } : {};
};

module.exports = {
  SANDBOX,
  isEnabled,
  isDemoPhone,
  isDemoRiderPhone,
  isDemoPassword,
  ensureSandbox,
  ensureDemoMember,
  ensureDemoRider,
  ensureDemoStop,
  isSandboxCaptain,
  sandboxLocationIds,
  sandboxZoneIds,
  isSandboxLocation,
  excludeSandboxLocations,
  invalidate,
};
