'use strict';

/**
 * chatModerationService.js — blocks, bans, and the filtering they imply.
 *
 * ==========================================================================
 * BLOCKING IS ONE-WAY. Here is the reasoning, because it is the decision
 * everything else in this file follows from.
 * ==========================================================================
 *
 * When A blocks B: A stops seeing B's messages. B's view of the group is
 * completely unchanged, and B is never told.
 *
 * The alternative — mutual invisibility, where neither sees the other — is
 * what a 1:1 messenger does, and it is wrong here for a specific reason.
 *
 * These are not private conversations. They are a zone's shared room: the
 * masjid group, a hostel's group. The people in it include that zone's
 * admin, who posts when Sehri is going out and who answers "I am not on
 * tonight's list". Under mutual blocking, any member could block the admin
 * and thereby make THEMSELVES invisible to the person coordinating their
 * food — unilaterally, silently, and probably without realising that is
 * what they had done. One person's comfort control would be quietly
 * removing another person's ability to do their job.
 *
 * It also would not buy the victim much. Blocking cannot stop someone
 * posting abuse into a shared room; everyone else still sees it. What
 * blocking can do is spare the victim from reading it. That is a personal
 * comfort control, and one-way is exactly the right shape for one.
 *
 * Stopping an abuser reaching the whole group is a different job, done by a
 * moderator through the report queue — delete the message, ban the account
 * from the room. That is Feature 3, and it is why blocking does not need to
 * carry weight it is badly suited to carry.
 *
 * ==========================================================================
 * FILTERING IS SERVER-SIDE.
 * ==========================================================================
 *
 * Client-side filtering would be a lie: the blocked person's words would
 * still be sent to the blocker's device, and anyone running a modified
 * client — or just reading the network tab — would receive content they
 * had explicitly asked never to see again. For a safety feature that is not
 * a performance trade-off, it is a broken promise.
 *
 * The cost is one indexed query per message fetch, returning a handful of
 * rows for the small number of people any one member has blocked. The
 * message query itself is already paginated and already resolves profiles
 * across three tables; this is not the expensive part.
 *
 * The one place filtering CANNOT happen server-side is the live socket
 * broadcast: emitNewMessage publishes to a room, and rooms have no
 * per-recipient view. So the payload carries the sender's identity and the
 * client drops messages from people it has blocked, using a list the server
 * gave it. That is belt-and-braces rather than the real defence — a client
 * that ignores it still cannot get the message back from history.
 */

const db = require('../models');

const { ChatUserBlock, ChatGroupMember } = db;

/** Stable key for a polymorphic identity. */
const identityKey = (id, type) => `${type}:${id}`;

/**
 * Everyone this actor has blocked, as a Set of "type:id" keys.
 *
 * Returns a Set rather than an array so the caller filters in O(1) per
 * message instead of scanning.
 */
const blockedByActor = async (actorId, actorType, { transaction } = {}) => {
  if (!actorId || !actorType) return new Set();
  const rows = await ChatUserBlock.findAll({
    where: { blocker_id: actorId, blocker_type: actorType },
    attributes: ['blocked_id', 'blocked_type'],
    raw: true,
    transaction,
  });
  return new Set(rows.map((r) => identityKey(r.blocked_id, r.blocked_type)));
};

/**
 * Is this specific person blocked by this actor?
 * One indexed lookup — for the single-message paths.
 */
const hasBlocked = async (actorId, actorType, targetId, targetType) => {
  if (!actorId || !targetId) return false;
  const row = await ChatUserBlock.findOne({
    where: {
      blocker_id: actorId,
      blocker_type: actorType,
      blocked_id: targetId,
      blocked_type: targetType,
    },
    attributes: ['id'],
  });
  return !!row;
};

/**
 * Drop messages sent by anyone in `blocked`.
 *
 * Works on raw ChatMessage rows (sender_id / sender_type) and on shaped
 * payloads (sender.id / sender.role), so both the history path and the
 * preview path in getMyGroups can use it.
 */
const filterBlockedMessages = (messages, blocked) => {
  if (!blocked || blocked.size === 0) return messages;
  return messages.filter((m) => {
    const id = m.sender_id ?? m.sender?.id;
    const type = m.sender_type ?? m.sender?.role;
    if (!id || !type) return true;
    return !blocked.has(identityKey(id, type));
  });
};

/**
 * The membership row for someone in a group, or null.
 * Used by both the ban check and the moderation endpoints.
 */
const membershipOf = async (groupId, userId, userType, { transaction } = {}) =>
  ChatGroupMember.findOne({
    where: { group_id: groupId, user_id: userId, user_type: userType },
    transaction,
  });

/**
 * Is this member banned from posting in this group?
 *
 * Read on the send path. A banned member keeps reading the room — removing
 * their access to a zone's delivery announcements would punish them with
 * something unrelated to what they did, and would also be the loud,
 * obvious signal that a quiet moderation action is not supposed to be.
 */
const isBannedFrom = async (groupId, userId, userType) => {
  const row = await membershipOf(groupId, userId, userType);
  return !!row && row.is_banned === true;
};

/**
 * Every group id whose zone links touch this admin's zone.
 *
 * Zone admins moderate their own room, matching how donations and feedback
 * are already scoped. A super admin bypasses this entirely.
 */
const groupIdsForZone = async (zoneLocationId) => {
  if (!zoneLocationId) return [];
  const rows = await db.ChatGroupZone.findAll({
    where: { zone_location_id: zoneLocationId },
    attributes: ['group_id'],
    raw: true,
  });
  return rows.map((r) => r.group_id);
};

/**
 * Can this moderator act on reports in this group?
 * Super admins: anywhere. Admins: groups covering their zone.
 */
const canModerateGroup = async (auth, groupId) => {
  if (auth.role === 'super_admin') return true;
  if (auth.role !== 'admin') return false;
  const ids = await groupIdsForZone(auth.zone_location_id);
  return ids.includes(groupId);
};

/**
 * The group-id filter for a moderator's report queue, or null for "no
 * filter" (super admin). An admin with no zone gets an empty array, which
 * correctly yields an empty queue rather than the whole community's.
 */
const moderatableGroupFilter = async (auth) => {
  if (auth.role === 'super_admin') return null;
  return groupIdsForZone(auth.zone_location_id);
};

module.exports = {
  identityKey,
  blockedByActor,
  hasBlocked,
  filterBlockedMessages,
  membershipOf,
  isBannedFrom,
  groupIdsForZone,
  canModerateGroup,
  moderatableGroupFilter,
};
