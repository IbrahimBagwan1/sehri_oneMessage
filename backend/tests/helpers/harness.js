'use strict';

/**
 * Test harness — the real app on an ephemeral port, plus a small world of
 * fixtures. Every suite builds its own world with fresh phone numbers, so
 * suites never depend on each other's data even though they share one
 * database (tests/run.js recreates it per run).
 */

process.env.NODE_ENV = 'test';
require('dotenv').config({ quiet: true });

// Deterministic, self-contained defaults for anything the .env may not set.
const defaults = {
  JWT_SECRET: 'test-access-secret-0123456789abcdef0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef0123456789abcd',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] = v;
// The suite never sends SMS, calls Google, or touches Cloudinary.
process.env.OTP_PROVIDER = 'local';
delete process.env.GOOGLE_MAPS_API_KEY;
for (const k of ['CLOUDINARY_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) delete process.env[k];

const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const db = require('../../src/models');
const { createApp } = require('../../src/app');
const socketService = require('../../src/services/socketService');
const locationIndex = require('../../src/services/locationIndex');
const zoneRegistry = require('../../src/services/zoneRegistry');
const reviewDemo = require('../../src/services/reviewDemoService');

let server = null;
let baseUrl = null;

const startServer = async () => {
  if (server) return baseUrl;
  server = http.createServer(createApp());
  socketService.initSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
};

const stopServer = async () => {
  try { socketService.getIO().close(); } catch (_) { /* never started */ }
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  await db.sequelize.close();
};

/** fetch wrapper → { status, body } */
const api = async (method, path, { token, body, ip } = {}) => {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // The app trusts one proxy hop, so this sets req.ip — lets a test play
      // "the attacker's network" and "the owner's network".
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* empty body */ }
  return { status: res.status, body: json };
};

const usedPhones = new Set();
/** A random, valid, unused Indian mobile number. */
const phone = () => {
  for (;;) {
    const p = `9${crypto.randomInt(100000000, 999999999)}`;
    if (!usedPhones.has(p)) { usedPhones.add(p); return p; }
  }
};

const PASSWORD = 'correct-horse-7';
let hashed = null;
const passwordHash = async () => {
  hashed = hashed || await bcrypt.hash(PASSWORD, 4);
  return hashed;
};

/**
 * A self-contained slice of the community:
 *   city → region → area → zone A (PG a1, a2) and zone B (PG b1)
 *   members: alice + amir (zone A), bilal (zone B), pending member pat (zone A)
 *   staff: an admin of zone A, a super admin
 */
const makeWorld = async () => {
  const tag = crypto.randomBytes(3).toString('hex');
  const { Location, User, Admin, SuperAdmin } = db;
  const L = (fields) => Location.create({ is_active: true, ...fields });

  const city = await L({ name: `City ${tag}`, type: 'city', parent_id: null });
  const region = await L({ name: `Region ${tag}`, type: 'region', parent_id: city.id });
  const area = await L({ name: `Area ${tag}`, type: 'area', parent_id: region.id });
  const zoneA = await L({ name: `Zone A ${tag}`, type: 'zone', parent_id: area.id, zone_key: `za_${tag}` });
  const zoneB = await L({ name: `Zone B ${tag}`, type: 'zone', parent_id: area.id, zone_key: `zb_${tag}` });
  const pgA1 = await L({ name: `PG a1 ${tag}`, type: 'address', parent_id: zoneA.id, latitude: 12.97, longitude: 77.59 });
  const pgA2 = await L({ name: `PG a2 ${tag}`, type: 'address', parent_id: zoneA.id, latitude: 12.98, longitude: 77.60 });
  const pgB1 = await L({ name: `PG b1 ${tag}`, type: 'address', parent_id: zoneB.id, latitude: 12.99, longitude: 77.61 });
  locationIndex.invalidate();
  zoneRegistry.invalidate();

  const pw = await passwordHash();
  const member = (name, pg, status = 'approved') => User.create({
    name, phone: phone(), password: pw, gender: 'male', occupation: 'student',
    location_id: pg.id, address: `${name}'s room`, status, is_phone_verified: true,
  });

  const alice = await member(`Alice ${tag}`, pgA1);
  const amir = await member(`Amir ${tag}`, pgA2);
  const bilal = await member(`Bilal ${tag}`, pgB1);
  const pat = await member(`Pat ${tag}`, pgA1, 'pending');
  const admin = await Admin.create({ name: `Admin ${tag}`, phone: phone(), password: pw, zone_location_id: zoneA.id });
  const superAdmin = await SuperAdmin.create({ name: `Super ${tag}`, phone: phone(), password: pw });

  return {
    tag, city, region, area, zoneA, zoneB, pgA1, pgA2, pgB1,
    alice, amir, bilal, pat, admin, superAdmin,
  };
};

/**
 * Delete everything a suite created: the world's locations and every row
 * hanging off them, every account created with a harness phone number, and
 * any polls the suite registered in world.createdPolls. Lets the suites run
 * against a shared database (tests/run.js --existing-db) and leave it as
 * they found it.
 */
const destroyWorld = async (world) => {
  if (!world) return;
  const { Op } = require('sequelize');
  const m = db;
  const phones = [...usedPhones];
  const locationIds = [world.pgA1, world.pgA2, world.pgB1, world.zoneA, world.zoneB, world.area, world.region, world.city]
    .filter(Boolean).map((l) => l.id);

  const users = await m.User.findAll({
    where: { [Op.or]: [{ location_id: { [Op.in]: locationIds } }, { phone: { [Op.in]: phones } }] },
    attributes: ['id'], raw: true,
  });
  const admins = await m.Admin.findAll({ where: { phone: { [Op.in]: phones } }, attributes: ['id'], raw: true });
  const supers = await m.SuperAdmin.findAll({ where: { phone: { [Op.in]: phones } }, attributes: ['id'], raw: true });
  const riders = await m.Rider.findAll({ where: { phone: { [Op.in]: phones } }, attributes: ['id'], raw: true });
  const userIds = users.map((u) => u.id);
  const staffIds = [...admins, ...supers].map((a) => a.id);
  const riderIds = riders.map((r) => r.id);
  const allIds = [...userIds, ...staffIds, ...riderIds];
  const pollIds = (world.createdPolls || []).map((p) => p.id);

  const groups = await m.ChatGroup.findAll({
    where: { [Op.or]: [{ default_zone_id: { [Op.in]: locationIds } }, { created_by: { [Op.in]: staffIds.length ? staffIds : [null] } }] },
    attributes: ['id'], raw: true,
  });
  const groupIds = [...groups.map((g) => g.id), ...(world.createdGroups || [])];

  const inIds = (ids) => ({ [Op.in]: ids.length ? ids : [null] });

  await m.AuthSession.destroy({ where: { subject_id: inIds(allIds) } });
  for (const p of phones) {
    await m.LoginThrottle.destroy({ where: { [Op.or]: [{ throttle_key: `p:${p}` }, { throttle_key: { [Op.like]: `pi:${p}:%` } }] } });
  }
  await m.OTP.destroy({ where: { phone: inIds(phones) } });
  await m.ChatMessageReport.destroy({
    where: { [Op.or]: [{ group_id: inIds(groupIds) }, { reporter_id: inIds(allIds) }, { reported_user_id: inIds(allIds) }] },
  });
  await m.ChatUserBlock.destroy({ where: { [Op.or]: [{ blocker_id: inIds(allIds) }, { blocked_id: inIds(allIds) }] } });
  await m.ChatMessage.destroy({ where: { [Op.or]: [{ group_id: inIds(groupIds) }, { sender_id: inIds(allIds) }] } });
  await m.ChatGroupMember.destroy({ where: { [Op.or]: [{ group_id: inIds(groupIds) }, { user_id: inIds(allIds) }] } });
  await m.ChatGroupZone.destroy({ where: { [Op.or]: [{ group_id: inIds(groupIds) }, { zone_location_id: inIds(locationIds) }] } });
  await m.ChatGroup.destroy({ where: { id: inIds(groupIds) } });
  await m.DeliveryStop.destroy({
    where: { [Op.or]: [{ location_id: inIds(locationIds) }, { rider_id: inIds(riderIds) }, { poll_id: inIds(pollIds) }] },
  });
  await m.PollResponse.destroy({ where: { [Op.or]: [{ user_id: inIds(userIds) }, { poll_id: inIds(pollIds) }] } });
  await m.Donation.destroy({ where: { user_id: inIds(userIds) } });
  await m.Feedback.destroy({ where: { user_id: inIds(userIds) } });
  await m.ProfileEditRequest.destroy({ where: { user_id: inIds(userIds) } });
  await m.CaptainZoneAssignment.destroy({
    where: { [Op.or]: [{ zone_location_id: inIds(locationIds) }, { captain_rider_id: inIds(riderIds) }] },
  });
  await m.Rider.update({ helper_rider_id: null }, { where: { helper_rider_id: inIds(riderIds) } });
  await m.Poll.destroy({ where: { id: inIds(pollIds) } });
  await m.Rider.destroy({ where: { id: inIds(riderIds) } });
  await m.Admin.destroy({ where: { id: inIds(admins.map((a) => a.id)) } });
  await m.SuperAdmin.destroy({ where: { id: inIds(supers.map((a) => a.id)) } });
  await m.User.destroy({ where: { id: inIds(userIds) } });
  for (const type of ['address', 'zone', 'area', 'region', 'city']) {
    await m.Location.destroy({ where: { id: inIds(locationIds), type } });
  }
  locationIndex.invalidate();
  zoneRegistry.invalidate();
};

/** Sign in through the real endpoint. Returns the response data. */
const login = async (account, password = PASSWORD) => {
  const r = await api('POST', '/auth/login', { body: { phone: account.phone, password } });
  if (r.status !== 200) throw new Error(`login failed for ${account.phone}: ${r.status} ${r.body?.message}`);
  return r.body.data;
};

module.exports = {
  db,
  api,
  destroyWorld,
  phone,
  login,
  makeWorld,
  startServer,
  stopServer,
  PASSWORD,
  locationIndex,
  reviewDemo,
};
