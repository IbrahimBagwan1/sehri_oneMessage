'use strict';

/**
 * The App Review sandbox: reviewers can always sign in, see nothing real,
 * and the fixed OTP works for their number only.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');

const DEMO_PHONE = h.phone();
const DEMO_RIDER_PHONE = h.phone();
Object.assign(process.env, {
  REVIEW_DEMO_ENABLED: 'true',
  REVIEW_DEMO_PHONE: DEMO_PHONE,
  REVIEW_DEMO_RIDER_PHONE: DEMO_RIDER_PHONE,
  REVIEW_DEMO_PASSWORD: 'Review-Demo-2027',
  REVIEW_DEMO_OTP: '246810',
});

let world;

test.before(async () => {
  await h.startServer();
  world = await h.makeWorld();
});
test.after(async () => {
  // The sandbox branch is shared state: remove it so the next run (and the
  // development database) start without it.
  const { Location, ChatGroup, ChatGroupMember, ChatGroupZone, CaptainZoneAssignment, DeliveryStop } = h.db;
  const sandbox = await Location.findAll({ where: { is_sandbox: true }, attributes: ['id'], raw: true });
  const ids = sandbox.map((l) => l.id);
  const groups = await ChatGroup.findAll({ where: { default_zone_id: ids.length ? ids : [null] }, attributes: ['id'], raw: true });
  world.createdGroups = groups.map((g) => g.id);
  await h.destroyWorld(world);
  await ChatGroupMember.destroy({ where: { group_id: world.createdGroups.length ? world.createdGroups : [null] } });
  await ChatGroupZone.destroy({ where: { zone_location_id: ids.length ? ids : [null] } });
  await ChatGroup.destroy({ where: { id: world.createdGroups.length ? world.createdGroups : [null] } });
  await DeliveryStop.destroy({ where: { location_id: ids.length ? ids : [null] } });
  await CaptainZoneAssignment.destroy({ where: { zone_location_id: ids.length ? ids : [null] } });
  for (const type of ['address', 'zone', 'area', 'region', 'city']) {
    await Location.destroy({ where: { is_sandbox: true, type } });
  }
  await h.stopServer();
});

test('the demo member signs in with the documented password and lands in the sandbox', async () => {
  const r = await h.api('POST', '/auth/login', { body: { phone: DEMO_PHONE, password: 'Review-Demo-2027' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const user = await h.db.User.findOne({ where: { phone: DEMO_PHONE } });
  assert.equal(user.status, 'approved');
  assert.equal(await h.reviewDemo.isSandboxLocation(user.location_id), true);
});

test('deleting the demo account does not lock out the next reviewer', async () => {
  const first = await h.api('POST', '/auth/login', { body: { phone: DEMO_PHONE, password: 'Review-Demo-2027' } });
  const del = await h.api('DELETE', '/users/me', { token: first.body.data.accessToken });
  assert.equal(del.status, 200);
  const again = await h.api('POST', '/auth/login', { body: { phone: DEMO_PHONE, password: 'Review-Demo-2027' } });
  assert.equal(again.status, 200, 'account recreated on the next sign-in');
});

test('the sandbox is hidden from the public location picker and from zone statistics', async () => {
  const locs = await h.api('GET', '/locations');
  const sandboxIds = await h.reviewDemo.sandboxLocationIds();
  assert.ok(locs.body.data.every((l) => !sandboxIds.has(l.id)));
  const zoneRegistry = require('../../src/services/zoneRegistry');
  zoneRegistry.invalidate();
  assert.ok(!(await zoneRegistry.zoneKeys()).includes(h.reviewDemo.SANDBOX.zoneKey));
});

test('the fixed OTP works for the demo number only', async () => {
  const otpService = require('../../src/services/otpService');
  await h.db.OTP.destroy({ where: { phone: DEMO_PHONE } });
  await otpService.sendOtp(DEMO_PHONE, 'forgot_password');
  assert.equal(await otpService.verifyOtp(DEMO_PHONE, 'forgot_password', '246810'), true);

  const someoneElse = h.phone();
  await otpService.sendOtp(someoneElse, 'registration');
  assert.equal(await otpService.verifyOtp(someoneElse, 'registration', '246810'), false,
    'the reviewer code is not a skeleton key');
});

test('registering with the demo number is forced into the sandbox and approved', async () => {
  await h.db.User.destroy({ where: { phone: DEMO_PHONE } });
  const otpService = require('../../src/services/otpService');
  await h.db.OTP.destroy({ where: { phone: DEMO_PHONE } });
  await otpService.sendOtp(DEMO_PHONE, 'registration');
  const r = await h.api('POST', '/auth/register', {
    body: {
      name: 'Reviewer', phone: DEMO_PHONE, password: 'whatever-123', gender: 'female',
      occupation: 'others', location_id: world.pgA1.id, address: 'n/a', otp: '246810',
    },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const user = await h.db.User.findOne({ where: { phone: DEMO_PHONE } });
  assert.equal(user.status, 'approved');
  assert.notEqual(user.location_id, world.pgA1.id, 'a real PG was requested; the sandbox PG was used');
  assert.equal(await h.reviewDemo.isSandboxLocation(user.location_id), true);
});

test('the demo rider signs in and captains only the sandbox zone', async () => {
  const r = await h.api('POST', '/tracking/rider-login', { body: { phone: DEMO_RIDER_PHONE, password: 'Review-Demo-2027' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rider = await h.db.Rider.findOne({ where: { phone: DEMO_RIDER_PHONE } });
  assert.equal(await h.reviewDemo.isSandboxCaptain(rider.id), true);

  const roster = await require('../../src/services/deliveryTeamService').getRoster();
  assert.ok(!roster.captains.some((c) => c.id === rider.id), 'demo rider is not on the real roster');
  assert.ok(!roster.all_zones.some((z) => z.zone_key === h.reviewDemo.SANDBOX.zoneKey), 'sandbox zone is never offered');
});

test('with the flag off, the demo password is just a wrong password', async () => {
  process.env.REVIEW_DEMO_ENABLED = 'false';
  try {
    await h.db.User.destroy({ where: { phone: DEMO_PHONE } });
    const r = await h.api('POST', '/auth/login', { body: { phone: DEMO_PHONE, password: 'Review-Demo-2027' } });
    assert.equal(r.status, 404);
  } finally {
    process.env.REVIEW_DEMO_ENABLED = 'true';
  }
});
