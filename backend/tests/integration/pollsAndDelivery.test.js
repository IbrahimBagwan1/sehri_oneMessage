'use strict';

/**
 * Poll lifecycle and delivery-list computation, through the real endpoints.
 *
 * Polls are keyed by date and globally unique, so on a shared database this
 * suite works on a far-future date it owns (and removes afterwards) rather
 * than on today's poll, which may belong to real data.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');
const { PHASES, getPollPhase } = require('../../src/utils/pollPhase');
const { istInstant } = require('../../src/utils/istTime');

let world;
let poll;
const DATE = '2031-01-15';

test.before(async () => {
  await h.startServer();
  world = await h.makeWorld();
  poll = await h.db.Poll.create({ date: DATE, is_active: null });
  world.createdPolls = [poll];
});
test.after(async () => {
  await h.destroyWorld(world);
  await h.stopServer();
});

test('a new poll follows the schedule (no standing override)', async () => {
  assert.equal(poll.is_active, null);
  assert.equal(getPollPhase(poll, istInstant(DATE, 9)), PHASES.VOTING);
  assert.equal(getPollPhase(poll, istInstant(DATE, 11)), PHASES.SPECIAL_CASE, 'closes on its own at 10:00');
});

test('a duplicate vote is a 409, never a 500 — including when two taps race', async () => {
  const { PollResponse } = h.db;
  // Forced open, so the test does not depend on the time of day it runs.
  await poll.update({ is_active: true });
  try {
    const alice = await h.login(world.alice);
    const cast = () => h.api('POST', `/polls/${poll.id}/respond`, { token: alice.accessToken, body: { response: 'yes' } });
    const [a, b] = await Promise.all([cast(), cast()]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], `got ${statuses}`);
  } finally {
    await poll.update({ is_active: null });
  }
  assert.equal(await PollResponse.count({ where: { poll_id: poll.id, user_id: world.alice.id } }), 1);
});

test('the delivery list counts yes votes, honours approved special cases, and groups by PG', async () => {
  const { PollResponse } = h.db;
  // alice: yes (already cast above). amir: yes then approved dont_want → excluded.
  // bilal: no then approved want → included.
  await PollResponse.create({
    poll_id: poll.id, user_id: world.amir.id, response: 'yes', zone: world.zoneA.zone_key,
    is_special_case: true, special_case_type: 'dont_want', sehri_allowed: 'approved',
  });
  await PollResponse.create({
    poll_id: poll.id, user_id: world.bilal.id, response: 'no', zone: world.zoneB.zone_key,
    is_special_case: true, special_case_type: 'want', sehri_allowed: 'approved',
  });

  const { __test } = require('../../src/controllers/trackingController');
  const pgs = await __test.computeDeliverablePGs(poll.id);
  const byLocation = Object.fromEntries(pgs.map((p) => [p.location_id, p.packet_count]));
  assert.equal(byLocation[world.pgA1.id], 1, 'alice\'s PG gets one packet');
  assert.equal(byLocation[world.pgA2.id], undefined, 'amir opted out and was approved');
  assert.equal(byLocation[world.pgB1.id], 1, 'bilal opted in and was approved');
});

test('an admin sees zone voters for their own zone (keyed by zone_key, not a name slug)', async () => {
  const admin = await h.login(world.admin);
  const r = await h.api('GET', `/polls/${poll.id}/zone-voters?response=all`, { token: admin.accessToken });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.zone, world.zoneA.zone_key);
  const names = Object.values(r.body.data.voters).flat().map((v) => v.user.name);
  assert.ok(names.includes(world.alice.name));
  assert.ok(!names.includes(world.bilal.name), 'another zone\'s voter is not visible');
});
