'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'unit-access-secret-0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET = 'unit-refresh-secret-0123456789abcdef012345678';

const jwt = require('jsonwebtoken');
const { redact, maskPhone } = require('../../src/utils/logger');
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../../src/utils/jwt');
const { looksLikeImage } = require('../../src/middleware/upload');
const { validateEnv } = require('../../src/config/env');

test('logs never carry a full phone number, push token or JWT', () => {
  const token = signAccessToken({ id: 'u1', role: 'user' });
  const line = redact(`GET /users/search?q=9876543210 by ExponentPushToken[abcDEF123] auth ${token} +91 9123456789`);
  assert.ok(!line.includes('9876543210'), line);
  assert.ok(!line.includes('9123456789'), line);
  assert.ok(line.includes('98*****210'), line);
  assert.ok(!line.includes('abcDEF123'), line);
  assert.ok(!line.includes(token), line);
});

test('redaction leaves UUIDs and ordinary numbers alone', () => {
  const uuid = '9f8e7d6c-5b4a-4321-9876-543210987654';
  assert.equal(redact(`poll ${uuid}`), `poll ${uuid}`);
  assert.equal(redact('took 1234 ms'), 'took 1234 ms');
  assert.equal(maskPhone('9141687582'), '91*****582');
});

test('a refresh token cannot be used as an access token, and vice versa', () => {
  const refresh = signRefreshToken({ sid: 's1', jti: 'j1' });
  assert.throws(() => verifyAccessToken(refresh));
  const access = signAccessToken({ id: 'u1', role: 'user' });
  assert.throws(() => verifyRefreshToken(access));
});

test('a phone-verification ticket signed with the access secret is not an access token', () => {
  const ticket = jwt.sign({ phone: '9876543210', purpose: 'registration', kind: 'phone_verification' }, process.env.JWT_SECRET);
  assert.throws(() => verifyAccessToken(ticket));
});

test('an access token signed with another algorithm is refused', () => {
  const forged = jwt.sign({ id: 'u1', role: 'super_admin', typ: 'access' }, process.env.JWT_SECRET, { algorithm: 'HS512' });
  assert.throws(() => verifyAccessToken(forged));
});

test('uploads are checked by content, not by the MIME type the client claims', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(4)]);
  const script = Buffer.from('<?php echo 1; ?>....');
  assert.equal(looksLikeImage(jpeg), true);
  assert.equal(looksLikeImage(png), true);
  assert.equal(looksLikeImage(heic), true);
  assert.equal(looksLikeImage(script), false);
});

test('environment validation fails fast on empty, weak or reused secrets', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production', DB_HOST: 'h', DB_NAME: 'n', DB_USER: 'u', DB_PASS: '',
      JWT_SECRET: 'short', JWT_REFRESH_SECRET: 'short', OTP_PROVIDER: 'local', CORS_ORIGIN: '*',
    });
    let message = '';
    try { validateEnv(); } catch (err) { message = err.message; }
    assert.match(message, /DB_PASS is empty/);
    assert.match(message, /JWT_SECRET must be at least 32/);
    assert.match(message, /must be different/);
    assert.match(message, /OTP_PROVIDER must be 'messagecentral'/);
    assert.match(message, /CORS_ORIGIN='\*' is not allowed/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
