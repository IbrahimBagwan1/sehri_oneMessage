'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness');

let world;

test.before(async () => {
  await h.startServer();
  world = await h.makeWorld();
});
test.after(async () => {
  await h.destroyWorld(world);
  await h.stopServer();
});

test('sign-in issues a session; the access token works', async () => {
  const data = await h.login(world.alice);
  assert.ok(data.accessToken && data.refreshToken);
  assert.equal(data.active_role, 'user');
  const me = await h.api('GET', '/users/me', { token: data.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.id, world.alice.id);
});

test('the password is checked before approval status is revealed', async () => {
  const wrong = await h.api('POST', '/auth/login', { body: { phone: world.pat.phone, password: 'nope-nope-1' } });
  assert.equal(wrong.status, 401, 'wrong password on a pending account says nothing about the account');
  const right = await h.api('POST', '/auth/login', { body: { phone: world.pat.phone, password: h.PASSWORD } });
  assert.equal(right.status, 403);
  assert.equal(right.body.code, 'ACCOUNT_PENDING');
});

test('refresh rotates: the new token works, the old one is retired', async () => {
  const { refreshToken } = await h.login(world.amir);
  const r1 = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.data.refreshToken, refreshToken);

  const r2 = await h.api('POST', '/auth/refresh-token', { body: { refreshToken: r1.body.data.refreshToken } });
  assert.equal(r2.status, 200, 'the rotated token is accepted');
});

test('a repeat of the just-retired token inside the grace window gets the CURRENT token back (idempotent)', async () => {
  const { refreshToken } = await h.login(world.amir);
  const first = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(first.status, 200);
  const repeat = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(repeat.status, 200, 'not an error, not a logout');
  const { verifyRefreshToken } = require('../../src/utils/jwt');
  assert.equal(verifyRefreshToken(repeat.body.data.refreshToken).jti, verifyRefreshToken(first.body.data.refreshToken).jti,
    'both callers converge on one refresh token');
  const next = await h.api('POST', '/auth/refresh-token', { body: { refreshToken: repeat.body.data.refreshToken } });
  assert.equal(next.status, 200, 'the session carries on');
});

test('many requests refreshing with the same token at the same moment all succeed; nobody is logged out', async () => {
  const { refreshToken } = await h.login(world.alice);
  const results = await Promise.all(
    Array.from({ length: 6 }, () => h.api('POST', '/auth/refresh-token', { body: { refreshToken } }))
  );
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
  const { verifyRefreshToken } = require('../../src/utils/jwt');
  const jtis = new Set(results.map((r) => verifyRefreshToken(r.body.data.refreshToken).jti));
  assert.equal(jtis.size, 1, 'one rotation, one current token');
  const { sid } = verifyRefreshToken(refreshToken);
  const row = await h.db.AuthSession.findByPk(sid);
  assert.equal(row.revoked_at, null, 'the session was not revoked as reuse');
});

test('replaying a retired refresh token after the grace window revokes the whole session (theft signal)', async () => {
  const { refreshToken } = await h.login(world.bilal);
  const rotated = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(rotated.status, 200);
  // Age the rotation past the grace window.
  const { verifyRefreshToken } = require('../../src/utils/jwt');
  const { sid } = verifyRefreshToken(refreshToken);
  await h.db.AuthSession.update({ rotated_at: new Date(Date.now() - 60 * 1000) }, { where: { id: sid } });

  const replay = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'SESSION_ENDED');
  const legit = await h.api('POST', '/auth/refresh-token', { body: { refreshToken: rotated.body.data.refreshToken } });
  assert.equal(legit.status, 401, 'the legitimate holder is signed out too, and must sign in again');
  const row = await h.db.AuthSession.findByPk(sid);
  assert.equal(row.revoked_reason, 'reuse_detected');
});

test('logout ends the session; its refresh token no longer works', async () => {
  const { refreshToken } = await h.login(world.alice);
  const out = await h.api('POST', '/auth/logout', { body: { refreshToken } });
  assert.equal(out.status, 200);
  const r = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(r.status, 401);
});

test('a removed admin cannot refresh their way back in', async () => {
  const { Admin } = h.db;
  const temp = await Admin.create({
    name: 'Temp admin', phone: h.phone(), password: await require('bcryptjs').hash(h.PASSWORD, 4),
    zone_location_id: world.zoneA.id,
  });
  const { refreshToken } = await h.login(temp);
  const sa = await h.login(world.superAdmin);
  const del = await h.api('DELETE', `/admin/admins/${temp.id}`, { token: sa.accessToken });
  assert.equal(del.status, 200);
  const r = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(r.status, 401);
});

test('refresh re-reads claims: a deactivated account cannot refresh', async () => {
  const { Admin } = h.db;
  const temp = await Admin.create({
    name: 'Temp admin 2', phone: h.phone(), password: await require('bcryptjs').hash(h.PASSWORD, 4),
    zone_location_id: world.zoneA.id,
  });
  const { refreshToken } = await h.login(temp);
  await temp.update({ is_active: false });
  const r = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'ACCOUNT_UNAVAILABLE');
});

test('an attacker cannot lock the owner out: failures lock only the attacker network', async () => {
  const { User } = h.db;
  const victim = await User.create({
    name: 'Lockout target', phone: h.phone(), password: await require('bcryptjs').hash(h.PASSWORD, 4),
    gender: 'male', occupation: 'student', location_id: world.pgA1.id, address: 'x',
    status: 'approved', is_phone_verified: true,
  });
  const ATTACKER = '203.0.113.7';
  const OWNER = '198.51.100.20';
  for (let i = 0; i < 5; i += 1) {
    const r = await h.api('POST', '/auth/login', { ip: ATTACKER, body: { phone: victim.phone, password: `wrong-${i}-xx` } });
    assert.equal(r.status, 401);
  }
  const attackerAgain = await h.api('POST', '/auth/login', { ip: ATTACKER, body: { phone: victim.phone, password: h.PASSWORD } });
  assert.equal(attackerAgain.status, 429, 'the attacking network is locked, even with the right password');
  assert.equal(attackerAgain.body.code, 'LOGIN_LOCKED');

  const owner = await h.api('POST', '/auth/login', { ip: OWNER, body: { phone: victim.phone, password: h.PASSWORD } });
  assert.equal(owner.status, 200, 'the owner on their own network signs in normally');
});

test('a distributed attack only switches the number to "reset with OTP", which the owner can always do', async () => {
  const { User } = h.db;
  const victim = await User.create({
    name: 'Distributed target', phone: h.phone(), password: await require('bcryptjs').hash(h.PASSWORD, 4),
    gender: 'female', occupation: 'student', location_id: world.pgA1.id, address: 'x',
    status: 'approved', is_phone_verified: true,
  });
  const throttle = require('../../src/services/loginThrottleService');
  for (let i = 0; i < throttle.PHONE_MAX_FAILURES; i += 1) {
    await h.api('POST', '/auth/login', { ip: `192.0.2.${i + 1}`, body: { phone: victim.phone, password: `nope-${i}-x` } });
  }
  const blocked = await h.api('POST', '/auth/login', { ip: '198.51.100.99', body: { phone: victim.phone, password: h.PASSWORD } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'LOGIN_STEP_UP');
  assert.match(blocked.body.message, /Forgot password/);

  // The owner resets with an OTP (possession of the phone) and is back in.
  const { hashOtp } = require('../../src/utils/otp');
  await h.db.OTP.create({
    phone: victim.phone, purpose: 'forgot_password', provider: 'local',
    otp_hash: await hashOtp('123456'), expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });
  const reset = await h.api('POST', '/auth/forgot-password/verify-otp', {
    body: { phone: victim.phone, otp: '123456', newPassword: 'brand-new-pass-9' },
  });
  assert.equal(reset.status, 200);
  const after = await h.api('POST', '/auth/login', { ip: '198.51.100.99', body: { phone: victim.phone, password: 'brand-new-pass-9' } });
  assert.equal(after.status, 200, 'the reset clears the step-up');
});

test('a password reset signs out every existing session for that number', async () => {
  const { User } = h.db;
  const u = await User.create({
    name: 'Reset target', phone: h.phone(), password: await require('bcryptjs').hash(h.PASSWORD, 4),
    gender: 'female', occupation: 'employee', location_id: world.pgA2.id, address: 'y',
    status: 'approved', is_phone_verified: true,
  });
  const { refreshToken } = await h.login(u);
  const { hashOtp } = require('../../src/utils/otp');
  await h.db.OTP.create({
    phone: u.phone, purpose: 'forgot_password', provider: 'local',
    otp_hash: await hashOtp('654321'), expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });
  const reset = await h.api('POST', '/auth/forgot-password/verify-otp', {
    body: { phone: u.phone, otp: '654321', newPassword: 'another-pass-8' },
  });
  assert.equal(reset.status, 200);
  const r = await h.api('POST', '/auth/refresh-token', { body: { refreshToken } });
  assert.equal(r.status, 401);
});

test('OTP attempts are capped even when guesses arrive in parallel', async () => {
  const p = h.phone();
  const { hashOtp } = require('../../src/utils/otp');
  await h.db.OTP.create({
    phone: p, purpose: 'registration', provider: 'local',
    otp_hash: await hashOtp('111111'), expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });
  const otpService = require('../../src/services/otpService');
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) => otpService.verifyOtp(p, 'registration', String(200000 + i)))
  );
  const checked = results.filter((r) => r.status === 'fulfilled').length;
  assert.ok(checked <= otpService.MAX_OTP_ATTEMPTS, `only ${otpService.MAX_OTP_ATTEMPTS} guesses may be evaluated, got ${checked}`);
});

test('a correct OTP can be consumed only once, even concurrently', async () => {
  const p = h.phone();
  const { hashOtp } = require('../../src/utils/otp');
  await h.db.OTP.create({
    phone: p, purpose: 'registration', provider: 'local',
    otp_hash: await hashOtp('222222'), expires_at: new Date(Date.now() + 5 * 60 * 1000),
  });
  const otpService = require('../../src/services/otpService');
  const results = await Promise.allSettled([1, 2, 3].map(() => otpService.verifyOtp(p, 'registration', '222222')));
  const wins = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  assert.equal(wins, 1);
});

test('a malformed or missing token is 401, not a crash', async () => {
  const r = await h.api('GET', '/users/me', { token: 'not.a.jwt' });
  assert.equal(r.status, 401);
  const r2 = await h.api('POST', '/auth/refresh-token', { body: { refreshToken: 'garbage' } });
  assert.equal(r2.status, 401);
});

test('login throttle rows (phone + network address) are purged after a day untouched', async () => {
  const { LoginThrottle, sequelize } = h.db;
  const loginThrottle = require('../../src/services/loginThrottleService');
  const keys = ['pi:9990000001:203.0.113.7', 'p:9990000001', 'pi:9990000002:203.0.113.8'];
  await LoginThrottle.destroy({ where: { throttle_key: keys } });
  await LoginThrottle.bulkCreate(keys.map((k) => ({ throttle_key: k, failures: 2, window_started_at: new Date(), lockouts: 1 })));
  // The first two were last touched two days ago; the third is current.
  await sequelize.query(
    'UPDATE login_throttles SET updated_at = NOW() - INTERVAL 2 DAY WHERE throttle_key IN (?, ?)',
    { replacements: [keys[0], keys[1]] }
  );
  await loginThrottle.purgeStale();
  const left = (await LoginThrottle.findAll({ where: { throttle_key: keys } })).map((r) => r.throttle_key);
  assert.deepEqual(left, [keys[2]], 'stale rows go, the current one stays');
  await LoginThrottle.destroy({ where: { throttle_key: keys } });
});
