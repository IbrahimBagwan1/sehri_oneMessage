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

/**
 * Seed a member with a footprint in every table deletion touches, then
 * delete through the real endpoint and inspect what is left.
 */
test('deleting an account erases identifying data everywhere and frees the number', async () => {
  const { User, ChatGroup, ChatGroupMember, ChatMessage, ChatUserBlock, ChatMessageReport,
    Donation, Feedback, ProfileEditRequest, OTP, AuthSession, Poll, PollResponse } = h.db;

  const bcrypt = require('bcryptjs');
  const leaver = await User.create({
    name: 'Leaving Member', phone: h.phone(), password: await bcrypt.hash(h.PASSWORD, 4),
    gender: 'female', occupation: 'student', location_id: world.pgA1.id, address: 'Room 4',
    status: 'approved', is_phone_verified: true, fcm_token: 'ExponentPushToken[leaver123]',
  });
  const session = await h.login(leaver);

  const group = await ChatGroup.create({ name: `Del group ${world.tag}`, created_by: world.superAdmin.id });
  world.createdGroups = [group.id];
  await ChatGroupMember.bulkCreate([
    { group_id: group.id, user_id: leaver.id, user_type: 'user' },
    { group_id: group.id, user_id: world.alice.id, user_type: 'user' },
  ]);
  const msg = await ChatMessage.create({ group_id: group.id, sender_id: leaver.id, sender_type: 'user', content: 'my secret words' });
  await ChatUserBlock.create({ blocker_id: leaver.id, blocker_type: 'user', blocked_id: world.alice.id, blocked_type: 'user' });
  await ChatUserBlock.create({ blocker_id: world.amir.id, blocker_type: 'user', blocked_id: leaver.id, blocked_type: 'user' });
  await ChatMessageReport.create({
    message_id: msg.id, group_id: group.id, reporter_id: world.alice.id, reporter_type: 'user',
    reported_user_id: leaver.id, reported_user_type: 'user', message_snapshot: 'my secret words',
    reported_user_name_snapshot: 'Leaving Member', status: 'pending',
  });
  const donation = await Donation.create({
    user_id: leaver.id, amount: 500, note: 'from Leaving Member',
    screenshot_url: 'https://res.cloudinary.com/demo/image/upload/v1/onemessage/donations/abc.jpg', status: 'verified',
  });
  await Feedback.create({ user_id: leaver.id, category: 'suggestion', message: 'more dates please' });
  await ProfileEditRequest.create({ user_id: leaver.id, requested_changes: { address: 'Room 9' } });
  await OTP.create({ phone: leaver.phone, purpose: 'forgot_password', provider: 'local', otp_hash: 'x', expires_at: new Date(Date.now() + 60000) });

  // A past vote (kept, detached) and today's vote (withdrawn).
  const { istDateString, addDays } = require('../../src/utils/istTime');
  const pastDate = addDays(istDateString(), -400);
  const past = await Poll.create({ date: pastDate, is_active: null });
  world.createdPolls = [past];
  await PollResponse.create({ poll_id: past.id, user_id: leaver.id, response: 'yes', zone: world.zoneA.zone_key });

  const del = await h.api('DELETE', '/users/me', { token: session.accessToken });
  assert.equal(del.status, 200, JSON.stringify(del.body));

  assert.equal(await User.count({ where: { id: leaver.id } }), 0, 'users row gone');
  const reloadedMsg = await ChatMessage.findByPk(msg.id);
  assert.equal(reloadedMsg.is_deleted, true);
  assert.equal(reloadedMsg.content, '[deleted]', 'message TEXT is overwritten, not just hidden');
  assert.equal(await ChatGroupMember.count({ where: { user_id: leaver.id } }), 0, 'left every group');
  assert.equal(await ChatUserBlock.count({ where: { blocker_id: leaver.id } }), 0, 'their blocks removed');
  assert.equal(await ChatUserBlock.count({ where: { blocked_id: leaver.id } }), 0, 'blocks of them removed');

  const report = await ChatMessageReport.findOne({ where: { reported_user_id: leaver.id } });
  assert.equal(report.reported_user_name_snapshot, 'Former member', 'name removed from the safety record');
  assert.equal(report.status, 'reviewed', 'pending report about them closed');

  const d = await Donation.findByPk(donation.id);
  assert.equal(d.user_id, null);
  assert.equal(d.screenshot_url, null, 'payment screenshot reference cleared');
  assert.equal(d.note, null, 'free-text note cleared');
  assert.equal(String(d.amount), '500.00', 'ledger amount kept');

  assert.equal(await Feedback.count({ where: { user_id: leaver.id } }), 0);
  assert.equal(await ProfileEditRequest.count({ where: { user_id: leaver.id } }), 0);
  assert.equal(await OTP.count({ where: { phone: leaver.phone } }), 0);
  const pastVote = await PollResponse.findOne({ where: { poll_id: past.id } });
  assert.equal(pastVote.user_id, null, 'history kept, detached');

  const sessions = await AuthSession.findAll({ where: { subject_id: leaver.id } });
  assert.ok(sessions.length > 0 && sessions.every((s) => s.revoked_at), 'every session revoked');
  const refresh = await h.api('POST', '/auth/refresh-token', { body: { refreshToken: session.refreshToken } });
  assert.equal(refresh.status, 401);

  // The number is free again.
  const accounts = await require('../../src/utils/phoneAccounts').findAccountsForPhone(leaver.phone);
  assert.equal(accounts.exists, false);
});

test('the last active super admin cannot delete themselves into a leaderless community', async () => {
  const { User, SuperAdmin } = h.db;
  const others = await SuperAdmin.count({ where: { is_active: true } });
  if (others > 1) return; // shared databases already have more than one — not testable here
  const bcrypt = require('bcryptjs');
  const u = await User.create({
    name: 'Only SA', phone: h.phone(), password: await bcrypt.hash(h.PASSWORD, 4), gender: 'male',
    occupation: 'employee', location_id: world.pgA1.id, address: 'x', status: 'approved', is_phone_verified: true,
  });
  await world.superAdmin.update({ user_id: u.id, phone: u.phone });
  const service = require('../../src/services/accountDeletionService');
  const res = await service.eraseUserAccount(u.id);
  assert.equal(res.blocked, 'LAST_SUPER_ADMIN');
});
