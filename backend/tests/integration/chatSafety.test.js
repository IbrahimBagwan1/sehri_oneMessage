'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const h = require('../helpers/harness');

let world;
let base;
let group;
let tokens = {};

const openSocket = (token) => new Promise((resolve, reject) => {
  const s = connect(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  s.once('connect', () => resolve(s));
  s.once('connect_error', reject);
});
const join = (sock, groupId) => new Promise((resolve) => sock.emit('join_group', { group_id: groupId }, resolve));

test.before(async () => {
  base = await h.startServer();
  world = await h.makeWorld();
  const { ChatGroup, ChatGroupMember } = h.db;
  group = await ChatGroup.create({ name: `Safety ${world.tag}`, created_by: world.superAdmin.id });
  world.createdGroups = [group.id];
  await ChatGroupMember.bulkCreate([
    { group_id: group.id, user_id: world.alice.id, user_type: 'user' },
    { group_id: group.id, user_id: world.amir.id, user_type: 'user' },
    { group_id: group.id, user_id: world.admin.id, user_type: 'admin' },
  ]);
  tokens = {
    alice: (await h.login(world.alice)).accessToken,
    amir: (await h.login(world.amir)).accessToken,
    bilal: (await h.login(world.bilal)).accessToken,
    admin: (await h.login(world.admin)).accessToken,
  };
});
test.after(async () => {
  await h.destroyWorld(world);
  await h.stopServer();
});

test('a non-member cannot join a group room over the socket, and receives nothing', async () => {
  const outsider = await openSocket(tokens.bilal);
  const member = await openSocket(tokens.amir);
  try {
    const refused = await join(outsider, group.id);
    assert.equal(refused.ok, false, 'join refused');
    const ok = await join(member, group.id);
    assert.equal(ok.ok, true, 'member joins');

    let leaked = false;
    outsider.on('new_message', () => { leaked = true; });
    const got = new Promise((resolve) => member.once('new_message', resolve));
    const sent = await h.api('POST', `/chat/groups/${group.id}/messages`, { token: tokens.alice, body: { content: 'hello room' } });
    assert.equal(sent.status, 201);
    await got;
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(leaked, false, 'outsider received nothing');
  } finally {
    outsider.close();
    member.close();
  }
});

test('objectionable messages are refused before they are stored or broadcast', async () => {
  const before = await h.db.ChatMessage.count({ where: { group_id: group.id } });
  const r = await h.api('POST', `/chat/groups/${group.id}/messages`, { token: tokens.alice, body: { content: 'you are a chutiya' } });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'CONTENT_BLOCKED');
  assert.equal(await h.db.ChatMessage.count({ where: { group_id: group.id } }), before);
});

test('over-long messages are refused', async () => {
  const r = await h.api('POST', `/chat/groups/${group.id}/messages`, { token: tokens.alice, body: { content: 'x'.repeat(2001) } });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'MESSAGE_TOO_LONG');
});

test('members do not see each other\'s phone numbers; staff do', async () => {
  const asMember = await h.api('GET', `/chat/groups/${group.id}`, { token: tokens.amir });
  assert.equal(asMember.status, 200);
  assert.ok(asMember.body.data.members.every((m) => m.phone === undefined), 'no phones for a member');
  const history = await h.api('GET', `/chat/groups/${group.id}/messages`, { token: tokens.amir });
  assert.ok(history.body.data.messages.every((m) => m.sender.phone === undefined), 'no phones on message senders');
  const asAdmin = await h.api('GET', `/chat/groups/${group.id}`, { token: tokens.admin });
  assert.ok(asAdmin.body.data.members.some((m) => typeof m.phone === 'string'), 'staff still see numbers');
});

test('report stores a snapshot; the reported person sees no change; blocking hides them server-side', async () => {
  const sent = await h.api('POST', `/chat/groups/${group.id}/messages`, { token: tokens.alice, body: { content: 'rude but not filtered' } });
  const msgId = sent.body.data.id;

  const report = await h.api('POST', `/chat/groups/${group.id}/messages/${msgId}/report`, {
    token: tokens.amir, body: { reason: 'harassment', block_sender: true },
  });
  assert.equal(report.status, 201);
  assert.equal(report.body.data.blocked_sender, true);
  const row = await h.db.ChatMessageReport.findByPk(report.body.data.report_id);
  assert.equal(row.message_snapshot, 'rude but not filtered');

  // Deleting the original does not erase the evidence.
  await h.api('DELETE', `/chat/groups/${group.id}/messages/${msgId}`, { token: tokens.alice });
  await row.reload();
  assert.equal(row.message_snapshot, 'rude but not filtered');

  // Amir (the blocker) no longer sees Alice's messages at all; Alice sees hers.
  const amirView = await h.api('GET', `/chat/groups/${group.id}/messages`, { token: tokens.amir });
  assert.ok(amirView.body.data.messages.every((m) => m.sender.id !== world.alice.id));
  const aliceView = await h.api('GET', `/chat/groups/${group.id}/messages`, { token: tokens.alice });
  assert.ok(aliceView.body.data.messages.some((m) => m.sender.id === world.alice.id));

  // Reporting twice is one report.
  const again = await h.api('POST', `/chat/groups/${group.id}/messages/${msgId}/report`, { token: tokens.amir, body: {} });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.already_reported, true);
});

test('the zone admin sees the report in their queue and can ban; a banned member cannot post', async () => {
  const { ChatGroupZone } = h.db;
  await ChatGroupZone.create({ group_id: group.id, zone_location_id: world.zoneA.id });

  const queue = await h.api('GET', '/admin/chat/reports?status=pending', { token: tokens.admin });
  assert.equal(queue.status, 200);
  const mine = queue.body.data.reports.find((r) => r.group?.id === group.id || r.group_id === group.id);
  assert.ok(mine, 'report visible to the admin of the group\'s zone');

  const resolve = await h.api('PATCH', `/admin/chat/reports/${mine.id}`, { token: tokens.admin, body: { ban_user: true, note: 'repeat' } });
  assert.equal(resolve.status, 200, JSON.stringify(resolve.body));
  const post = await h.api('POST', `/chat/groups/${group.id}/messages`, { token: tokens.alice, body: { content: 'am I banned?' } });
  assert.equal(post.status, 403);
  assert.equal(post.body.code, 'BANNED_FROM_GROUP');

  // Another zone's member cannot see this queue entry.
  const bilalQueue = await h.api('GET', '/admin/chat/reports', { token: tokens.bilal });
  assert.equal(bilalQueue.status, 403, 'members have no moderation access');
});

test('unblocking restores visibility', async () => {
  const r = await h.api('DELETE', `/chat/blocks/${world.alice.id}?user_type=user`, { token: tokens.amir });
  assert.equal(r.status, 200);
  const list = await h.api('GET', '/chat/blocks', { token: tokens.amir });
  assert.equal(list.body.data.total, 0);
});
