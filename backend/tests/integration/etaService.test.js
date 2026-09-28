'use strict';

/**
 * ETA service against a stubbed Google Directions: errors, quota failures,
 * zero stops, cumulative route ETAs, and the proximity push firing exactly
 * once per recipient — including when recomputes overlap.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const h = require('../helpers/harness');
const clock = require('../../src/utils/clock');
const { istInstant } = require('../../src/utils/istTime');
const googleMapsService = require('../../src/services/googleMapsService');
const expoPushService = require('../../src/services/expoPushService');
const etaService = require('../../src/services/etaComputationService');
const pollCalendar = require('../../src/services/pollCalendar');

const D = '2031-04-02';
let world;
let captain;
let poll;
let directionsCalls = 0;
let directionsImpl = null;
let pushes = [];
const real = {
  isConfigured: googleMapsService.isConfigured,
  directions: googleMapsService.directions,
  send: expoPushService.sendPushBatch,
};

// A route through N stops: each leg takes `legMinutes`.
const routeOf = (legs, legMinutes) => ({
  path: [[12.9, 77.5], [12.91, 77.51]],
  durationSeconds: legs * legMinutes * 60,
  waypointOrder: [],
  legs: Array.from({ length: legs }, () => ({ durationSeconds: legMinutes * 60, path: [[12.9, 77.5], [12.91, 77.51]] })),
});

test.before(async () => {
  await h.startServer();
  world = await h.makeWorld();
  googleMapsService.isConfigured = () => true;
  googleMapsService.directions = async (args) => { directionsCalls += 1; return directionsImpl(args); };
  expoPushService.sendPushBatch = async (messages) => { pushes.push(...messages); return { sent: messages.length, failed: 0, dropped: 0 }; };

  clock.set(istInstant(D, 20, 0));
  pollCalendar.invalidateDeliveryPoll();
  poll = await h.db.Poll.create({ date: D, is_active: null });
  world.createdPolls = [poll];
  captain = await h.db.Rider.create({
    name: 'ETA captain', phone: h.phone(), password: await bcrypt.hash(h.PASSWORD, 4), status: 'delivering',
  });
  for (const [i, m] of [world.alice, world.amir].entries()) {
    await m.update({ fcm_token: `ExponentPushToken[eta${world.tag}${i}]` });
    await h.db.PollResponse.create({ poll_id: poll.id, user_id: m.id, response: 'yes', zone: world.zoneA.zone_key });
  }
  // Visit order: a1 first, a2 second.
  await h.db.DeliveryStop.bulkCreate([
    { poll_id: poll.id, rider_id: captain.id, location_id: world.pgA1.id, packet_count: 1, sort_order: 1, status: 'pending' },
    { poll_id: poll.id, rider_id: captain.id, location_id: world.pgA2.id, packet_count: 1, sort_order: 2, status: 'pending' },
  ]);
});

test.after(async () => {
  clock.reset();
  googleMapsService.isConfigured = real.isConfigured;
  googleMapsService.directions = real.directions;
  expoPushService.sendPushBatch = real.send;
  await h.destroyWorld(world);
  await h.stopServer();
});

test.beforeEach(() => {
  etaService.resetThrottleForTests();
  directionsCalls = 0;
  pushes = [];
});

test('Google error or quota failure: no ETAs written, no pushes, nothing thrown', async () => {
  directionsImpl = async () => null; // what the wrapper returns on OVER_QUERY_LIMIT / network error
  await etaService.updateETAsForTeam(captain, 12.95, 77.55);
  assert.equal(directionsCalls, 1);
  assert.equal(pushes.length, 0);
  const rows = await h.db.PollResponse.findAll({ where: { poll_id: poll.id } });
  assert.ok(rows.every((r) => r.current_eta_minutes == null));

  // And it does not retry on every GPS push while Google is failing.
  await etaService.updateETAsForTeam(captain, 12.9501, 77.5501);
  assert.equal(directionsCalls, 1, 'throttled: no second call within the minimum interval');
});

test('one Directions request per recompute, and ETAs accumulate along the route', async () => {
  directionsImpl = async () => routeOf(2, 12); // 12 min per leg
  await etaService.updateETAsForTeam(captain, 12.95, 77.55);
  assert.equal(directionsCalls, 1, 'one request for the whole route, not one per PG');
  const alice = await h.db.PollResponse.findOne({ where: { poll_id: poll.id, user_id: world.alice.id } });
  const amir = await h.db.PollResponse.findOne({ where: { poll_id: poll.id, user_id: world.amir.id } });
  assert.equal(alice.current_eta_minutes, 12, 'first stop: first leg');
  assert.ok(amir.current_eta_minutes > 24, 'second stop: both legs plus the handover at the first');
  assert.equal(pushes.length, 0, 'nobody is within the proximity threshold yet');
});

test('the proximity push fires exactly once per recipient, even when recomputes overlap', async () => {
  // 1-minute legs: alice 1 min, amir 1 + 1.5 handover + 1 ≈ 4 min — both within 5.
  directionsImpl = async () => { await new Promise((r) => setTimeout(r, 50)); return routeOf(2, 1); };
  await Promise.all([
    etaService.updateETAsForTeam(captain, 12.96, 77.56),
    etaService.updateETAsForTeam(captain, 12.96, 77.56),
  ]);
  etaService.resetThrottleForTests();
  await etaService.updateETAsForTeam(captain, 12.961, 77.561);
  await new Promise((r) => setTimeout(r, 50));
  const arrivals = pushes.filter((p) => p.data?.type === 'delivery_arrival');
  const perRecipient = new Map();
  for (const p of arrivals) perRecipient.set(p.to, (perRecipient.get(p.to) || 0) + 1);
  assert.equal(perRecipient.size, 2, 'both recipients were told');
  assert.ok([...perRecipient.values()].every((n) => n === 1), `told once each, got ${JSON.stringify([...perRecipient.values()])}`);
});

test('zero pending stops: no Google call at all', async () => {
  await h.db.DeliveryStop.update({ status: 'delivered' }, { where: { poll_id: poll.id } });
  directionsImpl = async () => routeOf(1, 1);
  await etaService.updateETAsForTeam(captain, 12.97, 77.57);
  assert.equal(directionsCalls, 0);
});
