'use strict';

/**
 * One whole Sehri night, end to end, on a controllable clock.
 *
 * Every step goes through the real HTTP endpoints as the role that would
 * do it. Push notifications are captured by a mock provider (nothing is
 * sent). The poll date is far in the future so the suite never collides
 * with a real poll.
 *
 *   D-1 21:30  last night's run (poll D-1) still has a pending stop
 *   D-1 22:05  super admin opens tomorrow's poll → "poll open" push
 *   D-1 22:10  members vote; the rider still sees last night's stops
 *   D   00:30  run crossing midnight: rider still sees D-1's stop
 *   D   00:45  captain delivers it
 *   D   02:00  super admin closes voting early, then reopens it
 *   D   10:30  special-case window: opt out / opt in
 *   D   17:15  allotment: both approved
 *   D   18:30  delivery run generated for a captain + helper team
 *   D   19:00  a member deletes their account → their stop is withdrawn
 *   D   19:30  helper starts the round → "on the way" push; delivers
 *   D   20:00  helper deletes their (linked) account mid-cycle
 *   D   22:30  the finished poll stays finished
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const h = require('../helpers/harness');
const clock = require('../../src/utils/clock');
const { istInstant } = require('../../src/utils/istTime');
const expoPushService = require('../../src/services/expoPushService');
const pollCalendar = require('../../src/services/pollCalendar');

const D = '2031-03-10';
const DM1 = '2031-03-09';
const at = (date, hh, mm = 0) => clock.set(istInstant(date, hh, mm));

let world;
let pushes = [];
const realSend = expoPushService.sendPushBatch;
const tokens = {};
let captain;
let helper;
let helperUser;
let lastNightPoll;
let lastNightStop;

const pushTypes = () => pushes.map((m) => m.data?.type);

test.before(async () => {
  await h.startServer();
  world = await h.makeWorld();
  world.createdPolls = [];

  // Mock push provider: record every message, deliver none.
  expoPushService.sendPushBatch = async (messages) => {
    pushes.push(...messages);
    return { sent: messages.length, failed: 0, dropped: 0 };
  };

  // Members reachable by push.
  for (const [i, m] of [world.alice, world.amir, world.bilal].entries()) {
    await m.update({ fcm_token: `ExponentPushToken[night${world.tag}${i}]` });
  }

  const pw = await bcrypt.hash(h.PASSWORD, 4);
  const { Rider, User, CaptainZoneAssignment } = h.db;
  helperUser = await User.create({
    name: `Helper ${world.tag}`, phone: h.phone(), password: pw, gender: 'male', occupation: 'student',
    location_id: world.pgA1.id, address: 'helper room', status: 'approved', is_phone_verified: true,
  });
  captain = await Rider.create({ name: `Captain ${world.tag}`, phone: h.phone(), password: pw });
  helper = await Rider.create({ name: `Helper rider ${world.tag}`, phone: helperUser.phone, password: pw, user_id: helperUser.id });
  await captain.update({ helper_rider_id: helper.id });
  await CaptainZoneAssignment.bulkCreate([
    { captain_rider_id: captain.id, zone_location_id: world.zoneA.id },
    { captain_rider_id: captain.id, zone_location_id: world.zoneB.id },
  ]);

  // Last night's poll, with a run that is still out.
  lastNightPoll = await h.db.Poll.create({ date: DM1, is_active: null });
  world.createdPolls.push(lastNightPoll);
  lastNightStop = await h.db.DeliveryStop.create({
    poll_id: lastNightPoll.id, rider_id: captain.id, location_id: world.pgA1.id, packet_count: 1, status: 'pending',
  });

  tokens.alice = (await h.login(world.alice)).accessToken;
  tokens.amir = (await h.login(world.amir)).accessToken;
  tokens.bilal = (await h.login(world.bilal)).accessToken;
  tokens.admin = (await h.login(world.admin)).accessToken;
  tokens.sa = (await h.login(world.superAdmin)).accessToken;
  tokens.helperUser = (await h.login(helperUser)).accessToken;
  const riderLogin = async (r) => (await h.api('POST', '/tracking/rider-login', { body: { phone: r.phone, password: h.PASSWORD } })).body.data.accessToken;
  tokens.captain = await riderLogin(captain);
  tokens.helper = await riderLogin(helper);
});

test.after(async () => {
  clock.reset();
  expoPushService.sendPushBatch = realSend;
  const tonight = await h.db.Poll.findOne({ where: { date: D } });
  if (tonight) world.createdPolls.push(tonight);
  await h.destroyWorld(world);
  await h.stopServer();
});

let poll;

test('D-1 21:30 — no poll for tomorrow yet; members see last night\'s poll finished', async () => {
  at(DM1, 21, 30);
  const r = await h.api('GET', '/polls/active', { token: tokens.alice });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.poll.date, DM1);
  assert.equal(r.body.data.phase, 'status');
});

test('D-1 22:05 — super admin opens tomorrow\'s poll; members are told once', async () => {
  at(DM1, 22, 5);
  pushes = [];
  const r = await h.api('POST', '/polls/create-today', { token: tokens.sa });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.poll.date, D, 'from 22:00 the button opens TOMORROW\'s poll');
  assert.equal(r.body.data.phase, 'voting');
  assert.equal(r.body.data.poll.override, null, 'no standing override');
  poll = r.body.data.poll;
  await new Promise((res) => setTimeout(res, 100)); // background notify
  assert.ok(pushTypes().includes('poll_open'));
  const again = await h.api('POST', '/polls/create-today', { token: tokens.sa });
  assert.equal(again.status, 409, 'cannot be opened twice — so cannot notify twice');
});

test('D-1 22:10 — members vote; every role sees the same poll; the rider still sees last night\'s run', async () => {
  at(DM1, 22, 10);
  for (const [who, vote] of [['alice', 'yes'], ['amir', 'yes'], ['bilal', 'no']]) {
    const r = await h.api('POST', `/polls/${poll.id}/respond`, { token: tokens[who], body: { response: vote } });
    assert.equal(r.status, 201, `${who}: ${JSON.stringify(r.body)}`);
  }
  const member = await h.api('GET', '/polls/active', { token: tokens.alice });
  const admin = await h.api('GET', '/polls/active/stats', { token: tokens.admin });
  const sa = await h.api('GET', '/polls/active/stats', { token: tokens.sa });
  assert.equal(member.body.data.poll.id, poll.id);
  assert.equal(admin.body.data.poll.id, poll.id);
  assert.equal(sa.body.data.poll.id, poll.id);
  assert.equal(admin.body.data.by_zone[world.zoneA.zone_key].yes, 2, 'zone admin sees their zone');
  assert.equal(admin.body.data.by_zone[world.zoneB.zone_key], undefined, 'and only their zone');

  const stops = await h.api('GET', '/tracking/my-stops', { token: tokens.captain });
  assert.equal(stops.body.data.poll.id, lastNightPoll.id, 'the run in progress is last night\'s');
});

test('D 00:30 — a run crossing midnight keeps its stops; voting continues on tonight\'s poll', async () => {
  at(D, 0, 30);
  pollCalendar.invalidateDeliveryPoll();
  const stops = await h.api('GET', '/tracking/my-stops', { token: tokens.captain });
  assert.equal(stops.body.data.poll.id, lastNightPoll.id, 'stops did not vanish at midnight');
  assert.equal(stops.body.data.stops.length, 1);
  const helperView = await h.api('GET', '/tracking/my-stops', { token: tokens.helper });
  assert.deepEqual(helperView.body.data.stops.map((s) => s.id), stops.body.data.stops.map((s) => s.id), 'helper shares the captain\'s list');

  const member = await h.api('GET', '/polls/active', { token: tokens.alice });
  assert.equal(member.body.data.poll.id, poll.id);
  assert.equal(member.body.data.phase, 'voting');
});

test('D 00:45 — captain delivers last night\'s stop; the rider\'s view moves to tonight', async () => {
  at(D, 0, 45);
  const r = await h.api('PATCH', `/tracking/stops/${lastNightStop.id}/mark-delivered`, { token: tokens.captain });
  assert.equal(r.status, 200);
  pollCalendar.invalidateDeliveryPoll();
  const stops = await h.api('GET', '/tracking/my-stops', { token: tokens.captain });
  assert.equal(stops.body.data.poll.id, poll.id, 'nothing pending from last night → tonight\'s poll');
  assert.equal(stops.body.data.stops.length, 0, 'tonight\'s run is not generated yet');
});

test('D 02:00 — super admin closes voting early, then reopens it (no lingering override)', async () => {
  at(D, 2, 0);
  const close = await h.api('PATCH', '/polls/active/toggle', { token: tokens.sa, body: { is_active: false } });
  assert.equal(close.status, 200);
  assert.equal(close.body.data.phase, 'closed');
  const blocked = await h.api('POST', `/polls/${poll.id}/respond`, { token: tokens.helperUser, body: { response: 'no' } });
  assert.equal(blocked.status, 403);

  const reopen = await h.api('PATCH', '/polls/active/toggle', { token: tokens.sa, body: { is_active: true } });
  assert.equal(reopen.body.data.phase, 'voting');
  assert.equal(reopen.body.data.override, null, 'reopening inside the window restores the schedule');
  const ok = await h.api('POST', `/polls/${poll.id}/respond`, { token: tokens.helperUser, body: { response: 'no' } });
  assert.equal(ok.status, 201);
});

test('D 10:30 — voting has closed on its own; special cases open', async () => {
  at(D, 10, 30);
  const member = await h.api('GET', '/polls/active', { token: tokens.alice });
  assert.equal(member.body.data.phase, 'special_case', 'closed at 10:00 without anyone touching it');
  const late = await h.api('POST', `/polls/${poll.id}/respond`, { token: tokens.alice, body: { response: 'no' } });
  assert.equal(late.status, 403);
  const out = await h.api('POST', `/polls/${poll.id}/special-case`, { token: tokens.amir, body: { type: 'dont_want' } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const inn = await h.api('POST', `/polls/${poll.id}/special-case`, { token: tokens.bilal, body: { type: 'want' } });
  assert.equal(inn.status, 200);
});

test('D 17:15 — allotment: super admin approves both special cases', async () => {
  at(D, 17, 15);
  const list = await h.api('GET', '/polls/special-cases', { token: tokens.sa });
  const mine = list.body.data.cases.filter((c) => [world.amir.id, world.bilal.id].includes(c.user?.id));
  assert.equal(mine.length, 2);
  const allot = await h.api('POST', '/polls/special-cases/allot', {
    token: tokens.sa, body: { decisions: mine.map((c) => ({ response_id: c.id, decision: 'approved' })) },
  });
  assert.equal(allot.status, 200);
  assert.equal(allot.body.data.approved, 2);
});

test('D 18:30 — delivery run for the captain + helper team follows the votes and allotment', async () => {
  at(D, 18, 30);
  const member = await h.api('GET', '/polls/active', { token: tokens.alice });
  assert.equal(member.body.data.phase, 'status');
  const run = await h.api('POST', '/tracking/delivery-run/assign', { token: tokens.sa, body: { captain_ids: [captain.id] } });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  const stops = await h.db.DeliveryStop.findAll({ where: { poll_id: poll.id } });
  const byPg = Object.fromEntries(stops.map((s) => [s.location_id, s.packet_count]));
  assert.equal(byPg[world.pgA1.id], 1, 'alice (yes); helperUser voted no');
  assert.equal(byPg[world.pgA2.id], undefined, 'amir opted out and was approved');
  assert.equal(byPg[world.pgB1.id], 1, 'bilal opted in and was approved');

  const helperView = await h.api('GET', '/tracking/my-stops', { token: tokens.helper });
  assert.equal(helperView.body.data.team.my_role, 'helper');
  assert.equal(helperView.body.data.team.i_am_tracking, true, 'the helper\'s phone is the tracked device');
  assert.equal(helperView.body.data.stops.length, 2);
});

test('D 19:00 — a member deletes their account mid-cycle: their stop is withdrawn, history stays', async () => {
  at(D, 19, 0);
  const del = await h.api('DELETE', '/users/me', { token: tokens.bilal });
  assert.equal(del.status, 200);
  const stops = await h.db.DeliveryStop.findAll({ where: { poll_id: poll.id } });
  assert.equal(stops.find((s) => s.location_id === world.pgB1.id), undefined, 'nobody left at PG b1 wants food');
  assert.equal(stops.length, 1);
  const lastNight = await h.db.DeliveryStop.findByPk(lastNightStop.id);
  assert.equal(lastNight.status, 'delivered', 'last night\'s delivered stop is untouched');
});

test('D 19:30 — helper starts the round (zones told once) and delivers', async () => {
  at(D, 19, 30);
  pushes = [];
  const push = await h.api('PATCH', `/tracking/${helper.id}/push-location`, {
    token: tokens.helper, body: { latitude: 12.97, longitude: 77.59, status: 'delivering', current_address: 'x' },
  });
  assert.equal(push.status, 200);
  await new Promise((res) => setTimeout(res, 150));
  assert.ok(pushTypes().includes('delivery_started'));
  const count = pushTypes().filter((t) => t === 'delivery_started').length;

  const again = await h.api('PATCH', `/tracking/${helper.id}/push-location`, {
    token: tokens.helper, body: { latitude: 12.971, longitude: 77.591, status: 'delivering', current_address: 'x' },
  });
  assert.equal(again.status, 200);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(pushTypes().filter((t) => t === 'delivery_started').length, count, 'not re-sent on every GPS ping');

  const [stop] = await h.db.DeliveryStop.findAll({ where: { poll_id: poll.id } });
  const done = await h.api('PATCH', `/tracking/stops/${stop.id}/mark-delivered`, { token: tokens.helper });
  assert.equal(done.status, 200);
  await stop.reload();
  assert.equal(stop.delivered_by_rider_id, helper.id, 'records the hand that delivered');
});

test('D 20:00 — the helper deletes their linked account: allowed, the delivery record survives', async () => {
  at(D, 20, 0);
  const del = await h.api('DELETE', '/users/me', { token: tokens.helperUser });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(await h.db.Rider.count({ where: { id: helper.id } }), 0, 'their rider row is gone');
  const [stop] = await h.db.DeliveryStop.findAll({ where: { poll_id: poll.id } });
  assert.equal(stop.status, 'delivered');
  assert.equal(stop.delivered_by_rider_id, null, 'the hand is forgotten, the delivery is kept');
  await captain.reload();
  assert.equal(captain.helper_rider_id, null, 'the captain now works solo');
});

test('D 22:30 — the finished poll stays finished; it cannot be reopened', async () => {
  at(D, 22, 30);
  const member = await h.api('GET', '/polls/active', { token: tokens.alice });
  assert.equal(member.body.data.poll.id, poll.id);
  assert.equal(member.body.data.phase, 'status', 'never back to voting at 22:00');
  const reopen = await h.api('PATCH', '/polls/active/toggle', { token: tokens.sa, body: { is_active: true } });
  assert.equal(reopen.status, 409);
  assert.equal(reopen.body.code, 'POLL_DAY_ENDED');
});
