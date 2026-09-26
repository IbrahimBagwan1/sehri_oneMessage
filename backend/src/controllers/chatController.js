'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { FORMER_MEMBER_LABEL } = require('../utils/memberDisplay');
const chatGroupSync = require('../services/chatGroupSync');
const moderation = require('../services/chatModerationService');
const logger = require('../utils/logger');
const {
  emitNewMessage,
  emitMessageDeleted,
  emitMemberUpdate,
} = require('../services/socketService');

const {
  ChatGroup, ChatGroupMember, ChatGroupZone, ChatMessage,
  ChatMessageReport, ChatUserBlock,
  User, Admin, SuperAdmin, Location,
} = db;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derives the acting identity from the JWT payload — the same logic used
 * across the codebase (mirrors requireUserAccess middleware).
 *
 * Returns { actorId, actorType } where actorType is the role string that
 * maps to a DB table: 'user' | 'admin' | 'super_admin'.
 */
const getActor = (auth) => {
  const { id, role, user_id } = auth;
  // When an admin/super_admin acts as a user, their user_id is the user
  // identity but their role is still admin/super_admin in the token.
  // For chat we use their admin/super_admin identity as the sender.
  return { actorId: id, actorType: role };
};

/**
 * Looks up the display name for a sender/member from the correct table.
 * Returns { id, name, phone, role } or null if not found.
 */
const resolveProfile = async (userId, userType) => {
  let record = null;
  if (userType === 'user') {
    record = await User.findByPk(userId, { attributes: ['id', 'name', 'phone'] });
  } else if (userType === 'admin') {
    record = await Admin.findByPk(userId, { attributes: ['id', 'name', 'phone'] });
  } else if (userType === 'super_admin') {
    record = await SuperAdmin.findByPk(userId, { attributes: ['id', 'name', 'phone'] });
  }
  // A null record means the account was erased. Callers render whatever
  // comes back next to the message, so hand them a labelled placeholder
  // rather than null — the message stays in the thread, unattributed.
  if (!record) {
    return { id: userId, name: FORMER_MEMBER_LABEL, phone: null, role: userType, is_former_member: true };
  }
  return { id: record.id, name: record.name, phone: record.phone, role: userType };
};

/**
 * Resolves profiles for an array of member rows.
 * Groups them by type for batch fetching to avoid N+1 queries.
 *
 * @param {ChatGroupMember[]} members
 * @returns {Promise<Array<{ member_id, user_id, user_type, name, phone, last_read_at }>>}
 */
const resolveMemberProfiles = async (members) => {
  // Group member rows by type so we can do one query per table.
  const byType = { user: [], admin: [], super_admin: [] };
  for (const m of members) {
    byType[m.user_type].push(m.user_id);
  }

  const [users, admins, superAdmins] = await Promise.all([
    byType.user.length
      ? User.findAll({ where: { id: byType.user }, attributes: ['id', 'name', 'phone'] })
      : [],
    byType.admin.length
      ? Admin.findAll({ where: { id: byType.admin }, attributes: ['id', 'name', 'phone'] })
      : [],
    byType.super_admin.length
      ? SuperAdmin.findAll({ where: { id: byType.super_admin }, attributes: ['id', 'name', 'phone'] })
      : [],
  ]);

  // Build lookup maps: id -> record
  const profileMap = {};
  for (const u of users) profileMap[u.id] = { ...u.dataValues, role: 'user' };
  for (const a of admins) profileMap[a.id] = { ...a.dataValues, role: 'admin' };
  for (const sa of superAdmins) profileMap[sa.id] = { ...sa.dataValues, role: 'super_admin' };

  return members.map((m) => ({
    member_id: m.id,
    user_id: m.user_id,
    user_type: m.user_type,
    // 'auto' members are in the room because the group's zones put them
    // there; the UI marks them as fixed and the remove endpoint refuses.
    source: m.source,
    last_read_at: m.last_read_at,
    ...(profileMap[m.user_id] || { name: FORMER_MEMBER_LABEL, phone: null, is_former_member: true }),
  }));
};

/**
 * A Sequelize where-fragment excluding every sender this actor has blocked.
 *
 * Blocks are polymorphic, so "not this id" is not enough on its own — a
 * user and an admin could in principle share a uuid. Each blocked identity
 * becomes an AND NOT (sender_id = x AND sender_type = y).
 *
 * Returns {} for an actor who has blocked nobody, which is almost everyone,
 * so the common case adds nothing to the query at all.
 */
const buildBlockExclusion = (blockedSet) => {
  if (!blockedSet || blockedSet.size === 0) return {};
  const clauses = [];
  for (const key of blockedSet) {
    const idx = key.indexOf(':');
    const type = key.slice(0, idx);
    const id = key.slice(idx + 1);
    clauses.push({
      [Op.not]: { sender_id: id, sender_type: type },
    });
  }
  return { [Op.and]: clauses };
};

/**
 * Shapes a ChatMessage row into the response object sent to clients
 * and emitted via Socket.IO.
 */
const shapeMessage = (msg, senderProfile, repliedTo = null) => ({
  id: msg.id,
  group_id: msg.group_id,
  sender: senderProfile,
  content: msg.is_deleted ? null : msg.content,
  is_deleted: msg.is_deleted,
  reply_to: repliedTo,
  created_at: msg.created_at,
  updated_at: msg.updated_at,
});

// ---------------------------------------------------------------------------
// GET /api/chat/groups
// Access: any authenticated user / admin / super_admin
//
// Returns all groups the caller is a member of, with the unread message
// count for each group and the latest message preview.
// ---------------------------------------------------------------------------
const getMyGroups = async (req, res, next) => {
  try {
    const { actorId, actorType } = getActor(req.auth);

    // Find all group memberships for this user
    const memberships = await ChatGroupMember.findAll({
      where: { user_id: actorId, user_type: actorType },
    });

    if (!memberships.length) {
      return success(res, {
        statusCode: 200,
        message: 'No groups found',
        data: { groups: [] },
      });
    }

    const groupIds = memberships.map((m) => m.group_id);
    const membershipMap = Object.fromEntries(memberships.map((m) => [m.group_id, m]));

    // A blocked person must not reach the blocker through the group list
    // either. Without this their message is still the preview line under
    // the group name, and still counts toward the unread badge — so the
    // blocker is pulled into the room by someone they chose not to see.
    const blocked = await moderation.blockedByActor(actorId, actorType);
    const blockClause = buildBlockExclusion(blocked);

    // Fetch group records (active only)
    const groups = await ChatGroup.findAll({
      where: { id: groupIds, is_active: true },
      order: [['updated_at', 'DESC']],
    });

    // For each group compute unread count and latest message in parallel
    const enriched = await Promise.all(
      groups.map(async (group) => {
        const membership = membershipMap[group.id];
        const lastReadAt = membership.last_read_at;

        // Count messages sent after last_read_at
        const unreadCount = await ChatMessage.count({
          where: {
            group_id: group.id,
            is_deleted: false,
            ...blockClause,
            ...(lastReadAt ? { created_at: { [Op.gt]: lastReadAt } } : {}),
          },
        });

        // Latest message preview — the newest one this member can see,
        // which is not necessarily the newest one in the group.
        const latestMessage = await ChatMessage.findOne({
          where: { group_id: group.id, ...blockClause },
          order: [['created_at', 'DESC']],
          attributes: ['id', 'sender_id', 'sender_type', 'content', 'is_deleted', 'created_at'],
        });

        let latestPreview = null;
        if (latestMessage) {
          const senderProfile = await resolveProfile(
            latestMessage.sender_id,
            latestMessage.sender_type
          );
          latestPreview = {
            id: latestMessage.id,
            sender: senderProfile,
            content: latestMessage.is_deleted ? null : latestMessage.content,
            is_deleted: latestMessage.is_deleted,
            created_at: latestMessage.created_at,
          };
        }

        return {
          id: group.id,
          name: group.name,
          description: group.description,
          created_by: group.created_by,
          unread_count: unreadCount,
          latest_message: latestPreview,
          // So the room can open with the composer already closed rather
          // than letting someone type a paragraph into a 403.
          is_banned: !!membership.is_banned,
          ban_reason: membership.is_banned ? membership.ban_reason : null,
          updated_at: group.updated_at,
        };
      })
    );

    return success(res, {
      statusCode: 200,
      message: 'Groups fetched',
      data: { groups: enriched },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/chat/groups
// Body: { name, description?, member_ids: [{ user_id, user_type }],
//         zone_location_ids?: [uuid] }
// Access: super_admin only
//
// Creates a chat group with the given members plus the creator. Passing
// zone_location_ids makes it zone-backed from the start: everyone in those
// zones joins immediately and stays in sync, exactly like a default group.
// ---------------------------------------------------------------------------
const createGroup = async (req, res, next) => {
  try {
    const { name, description, member_ids = [], zone_location_ids = [] } = req.body;
    const { actorId } = getActor(req.auth);

    if (!name || !name.trim()) {
      return error(res, { statusCode: 400, message: 'Group name is required' });
    }

    // Validate member_ids format
    for (const m of member_ids) {
      if (!m.user_id || !['user', 'admin', 'super_admin'].includes(m.user_type)) {
        return error(res, {
          statusCode: 400,
          message: 'Each member must have user_id and a valid user_type',
        });
      }
    }

    const group = await ChatGroup.create({
      name: name.trim(),
      description: description?.trim() || null,
      created_by: actorId,
      is_active: true,
    });

    // Always add the creator as a member
    const creatorEntry = { group_id: group.id, user_id: actorId, user_type: 'super_admin' };
    const memberEntries = [
      creatorEntry,
      // De-duplicate: skip if creator is already in the list
      ...member_ids
        .filter((m) => !(m.user_id === actorId && m.user_type === 'super_admin'))
        .map((m) => ({ group_id: group.id, user_id: m.user_id, user_type: m.user_type })),
    ];

    await ChatGroupMember.bulkCreate(memberEntries, { ignoreDuplicates: true });

    // Link any zones, then reconcile once so the response carries a real
    // member count rather than just the hand-picked list.
    let zoneNames = [];
    if (zone_location_ids.length) {
      const zones = await Location.findAll({
        where: { id: zone_location_ids, type: 'zone', is_active: true },
        attributes: ['id', 'name'],
      });
      if (zones.length) {
        await ChatGroupZone.bulkCreate(
          zones.map((z) => ({ group_id: group.id, zone_location_id: z.id })),
          { ignoreDuplicates: true }
        );
        await chatGroupSync.reconcileGroup(group);
        zoneNames = zones.map((z) => z.name);
      }
    }

    const memberCount = await ChatGroupMember.count({ where: { group_id: group.id } });

    return success(res, {
      statusCode: 201,
      message: zoneNames.length
        ? `Group created, covering ${zoneNames.join(', ')}.`
        : 'Group created',
      data: {
        id: group.id,
        name: group.name,
        description: group.description,
        created_by: group.created_by,
        zones: zoneNames,
        member_count: memberCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/chat/groups/:id
// Access: group members only
//
// Returns group metadata + full member list with profiles.
// ---------------------------------------------------------------------------
const getGroupDetails = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const { actorId, actorType } = getActor(req.auth);

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    // Verify the caller is a member
    const membership = await ChatGroupMember.findOne({
      where: { group_id: groupId, user_id: actorId, user_type: actorType },
    });
    if (!membership) {
      return error(res, { statusCode: 403, message: 'You are not a member of this group' });
    }

    const allMembers = await ChatGroupMember.findAll({ where: { group_id: groupId } });
    const enrichedMembers = await resolveMemberProfiles(allMembers);

    // The zones whose members are pulled in automatically. Ordered by name so
    // the chips render in a stable order between reloads.
    const zoneLinks = await ChatGroupZone.findAll({
      where: { group_id: groupId },
      include: [{ model: Location, as: 'zone', attributes: ['id', 'name'] }],
    });
    const zones = zoneLinks
      .filter((z) => z.zone)
      .map((z) => ({ id: z.zone.id, name: z.zone.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return success(res, {
      statusCode: 200,
      message: 'Group details fetched',
      data: {
        id: group.id,
        name: group.name,
        description: group.description,
        created_by: group.created_by,
        is_active: group.is_active,
        is_default: group.is_default,
        zones,
        members: enrichedMembers,
        // The caller's own posting state. Surfaced here rather than making
        // the chat room fetch the whole group list to find one boolean.
        my_membership: {
          is_banned: !!membership.is_banned,
          ban_reason: membership.is_banned ? membership.ban_reason : null,
        },
        created_at: group.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/chat/groups/:id/messages
// Query: ?page=1&limit=30
// Access: group members only
//
// Returns paginated messages, newest first. Each message includes:
//  - sender profile (name, role)
//  - the replied-to message preview (if any)
// Deleted messages show is_deleted=true with null content (so reply threads
// don't have gaps).
// ---------------------------------------------------------------------------
const getMessages = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const { actorId, actorType } = getActor(req.auth);

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const offset = (page - 1) * limit;

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    // Verify membership
    const membership = await ChatGroupMember.findOne({
      where: { group_id: groupId, user_id: actorId, user_type: actorType },
    });
    if (!membership) {
      return error(res, { statusCode: 403, message: 'You are not a member of this group' });
    }

    // Blocked senders are excluded IN THE QUERY, not after it. Filtering
    // the page afterwards would silently shrink pages — a page of 30 that
    // returns 24 looks to the client like the end of the history — and
    // would still have loaded the content we promised never to show.
    //
    // See services/chatModerationService.js for why this is server-side.
    const blocked = await moderation.blockedByActor(actorId, actorType);
    const blockClause = buildBlockExclusion(blocked);

    const { count, rows: messages } = await ChatMessage.findAndCountAll({
      where: { group_id: groupId, ...blockClause },
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    // Collect unique sender ids per type for batch profile resolution
    const senderIds = { user: [], admin: [], super_admin: [] };
    const replyIds = messages.map((m) => m.reply_to_id).filter(Boolean);

    for (const msg of messages) {
      if (!senderIds[msg.sender_type].includes(msg.sender_id)) {
        senderIds[msg.sender_type].push(msg.sender_id);
      }
    }

    // Batch fetch sender profiles
    const [userProfiles, adminProfiles, superAdminProfiles] = await Promise.all([
      senderIds.user.length
        ? User.findAll({ where: { id: senderIds.user }, attributes: ['id', 'name', 'phone'] })
        : [],
      senderIds.admin.length
        ? Admin.findAll({ where: { id: senderIds.admin }, attributes: ['id', 'name', 'phone'] })
        : [],
      senderIds.super_admin.length
        ? SuperAdmin.findAll({
            where: { id: senderIds.super_admin },
            attributes: ['id', 'name', 'phone'],
          })
        : [],
    ]);

    const profileMap = {};
    for (const u of userProfiles) profileMap[u.id] = { ...u.dataValues, role: 'user' };
    for (const a of adminProfiles) profileMap[a.id] = { ...a.dataValues, role: 'admin' };
    for (const sa of superAdminProfiles) profileMap[sa.id] = { ...sa.dataValues, role: 'super_admin' };

    // Batch fetch replied-to messages
    const repliedToMap = {};
    if (replyIds.length) {
      const repliedMessages = await ChatMessage.findAll({
        where: { id: replyIds },
        attributes: ['id', 'sender_id', 'sender_type', 'content', 'is_deleted'],
      });
      for (const r of repliedMessages) {
        repliedToMap[r.id] = {
          id: r.id,
          sender: profileMap[r.sender_id] || null,
          content: r.is_deleted ? null : r.content,
          is_deleted: r.is_deleted,
        };
      }
    }

    const shaped = messages.map((msg) =>
      shapeMessage(
        msg,
        profileMap[msg.sender_id]
          || { id: msg.sender_id, name: FORMER_MEMBER_LABEL, role: msg.sender_type, is_former_member: true },
        msg.reply_to_id ? (repliedToMap[msg.reply_to_id] || null) : null
      )
    );

    return success(res, {
      statusCode: 200,
      message: 'Messages fetched',
      data: {
        total: count,
        page,
        limit,
        messages: shaped,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/chat/groups/:id/messages
// Body: { content, reply_to_id? }
// Access: group members only
//
// Saves the message to DB then emits 'new_message' to the group Socket.IO room.
// ---------------------------------------------------------------------------
const sendMessage = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const { content, reply_to_id } = req.body;
    const { actorId, actorType } = getActor(req.auth);

    if (!content || !content.trim()) {
      return error(res, { statusCode: 400, message: 'Message content is required' });
    }

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    // Verify membership
    const membership = await ChatGroupMember.findOne({
      where: { group_id: groupId, user_id: actorId, user_type: actorType },
    });
    if (!membership) {
      return error(res, { statusCode: 403, message: 'You are not a member of this group' });
    }

    // A moderator has banned this member from posting here. They keep
    // reading the room — cutting their access to a zone's delivery
    // announcements would punish them with something unrelated to what
    // they did — but the composer is closed.
    if (membership.is_banned) {
      return error(res, {
        statusCode: 403,
        code: 'BANNED_FROM_GROUP',
        message: membership.ban_reason
          ? `You can no longer post in this group. Reason: ${membership.ban_reason}`
          : 'You can no longer post in this group. Contact an admin if you think this is a mistake.',
      });
    }

    // Validate reply_to_id if provided
    let repliedToPreview = null;
    if (reply_to_id) {
      const parent = await ChatMessage.findOne({
        where: { id: reply_to_id, group_id: groupId },
        attributes: ['id', 'sender_id', 'sender_type', 'content', 'is_deleted'],
      });
      if (!parent) {
        return error(res, {
          statusCode: 404,
          message: 'The message you are replying to was not found in this group',
        });
      }
      const parentSender = await resolveProfile(parent.sender_id, parent.sender_type);
      repliedToPreview = {
        id: parent.id,
        sender: parentSender,
        content: parent.is_deleted ? null : parent.content,
        is_deleted: parent.is_deleted,
      };
    }

    const message = await ChatMessage.create({
      group_id: groupId,
      sender_id: actorId,
      sender_type: actorType,
      content: content.trim(),
      reply_to_id: reply_to_id || null,
    });

    // Touch the group's updated_at so it floats to top of sorted list
    await group.update({ updated_at: new Date() });

    const senderProfile = await resolveProfile(actorId, actorType);
    const payload = shapeMessage(message, senderProfile, repliedToPreview);

    // Broadcast to all connected members in real-time
    emitNewMessage(groupId, payload);

    return success(res, {
      statusCode: 201,
      message: 'Message sent',
      data: payload,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/chat/groups/:id/messages/:msgId
// Access: message owner OR super_admin
//
// Soft-deletes the message (sets is_deleted = true, clears content).
// Emits 'message_deleted' to the room so clients can update their UI.
// ---------------------------------------------------------------------------
const deleteMessage = async (req, res, next) => {
  try {
    const { id: groupId, msgId } = req.params;
    const { actorId, actorType } = getActor(req.auth);

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    const message = await ChatMessage.findOne({ where: { id: msgId, group_id: groupId } });
    if (!message) {
      return error(res, { statusCode: 404, message: 'Message not found' });
    }

    if (message.is_deleted) {
      return error(res, { statusCode: 409, message: 'Message is already deleted' });
    }

    // Permission: must be the owner OR a super_admin
    const isOwner = message.sender_id === actorId && message.sender_type === actorType;
    const isSuperAdmin = actorType === 'super_admin';

    if (!isOwner && !isSuperAdmin) {
      return error(res, {
        statusCode: 403,
        message: 'You can only delete your own messages',
      });
    }

    await message.update({ is_deleted: true, content: '[deleted]' });

    // Notify connected clients
    emitMessageDeleted(groupId, msgId);

    return success(res, {
      statusCode: 200,
      message: 'Message deleted',
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/chat/groups/:id/read
// Access: group members only
//
// Updates last_read_at to now for the calling user, clearing their unread count.
// ---------------------------------------------------------------------------
const markAsRead = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const { actorId, actorType } = getActor(req.auth);

    const membership = await ChatGroupMember.findOne({
      where: { group_id: groupId, user_id: actorId, user_type: actorType },
    });
    if (!membership) {
      return error(res, { statusCode: 403, message: 'You are not a member of this group' });
    }

    await membership.update({ last_read_at: new Date() });

    return success(res, {
      statusCode: 200,
      message: 'Marked as read',
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/chat/groups/:id/members
// Body: { members: [{ user_id, user_type }] }
// Access: super_admin only
//
// Adds one or more members to an existing group.
// Silently ignores entries that are already members (ignoreDuplicates).
// ---------------------------------------------------------------------------
const addMembers = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const { members = [] } = req.body;

    if (!members.length) {
      return error(res, { statusCode: 400, message: 'members array is required and must not be empty' });
    }

    for (const m of members) {
      if (!m.user_id || !['user', 'admin', 'super_admin'].includes(m.user_type)) {
        return error(res, {
          statusCode: 400,
          message: 'Each member must have user_id and a valid user_type',
        });
      }
    }

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    // Explicitly manual: the reconciler leaves these alone, and they stay
    // removable. Anyone who also qualifies through the group's zones is
    // promoted to 'auto' on the next reconcile and becomes fixed.
    const entries = members.map((m) => ({
      group_id: groupId,
      user_id: m.user_id,
      user_type: m.user_type,
      source: 'manual',
    }));

    await ChatGroupMember.bulkCreate(entries, { ignoreDuplicates: true });

    // Notify existing members in the room
    for (const m of members) {
      const profile = await resolveProfile(m.user_id, m.user_type);
      emitMemberUpdate(groupId, 'member_added', { group_id: groupId, member: profile });
    }

    const totalMembers = await ChatGroupMember.count({ where: { group_id: groupId } });

    return success(res, {
      statusCode: 200,
      message: `${members.length} member(s) added`,
      data: { group_id: groupId, total_members: totalMembers },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/chat/groups/:id/members/:userId
// Query: ?user_type=user|admin|super_admin  (required)
// Access: super_admin only
//
// Removes a member from the group. The group creator cannot be removed.
// ---------------------------------------------------------------------------
const removeMember = async (req, res, next) => {
  try {
    const { id: groupId, userId } = req.params;
    const { user_type } = req.query;

    if (!user_type || !['user', 'admin', 'super_admin'].includes(user_type)) {
      return error(res, {
        statusCode: 400,
        message: "Query param 'user_type' is required: user | admin | super_admin",
      });
    }

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    // Protect the group creator from being removed
    if (group.created_by === userId && user_type === 'super_admin') {
      return error(res, {
        statusCode: 403,
        message: 'The group creator cannot be removed',
      });
    }

    const membership = await ChatGroupMember.findOne({
      where: { group_id: groupId, user_id: userId, user_type },
    });
    if (!membership) {
      return error(res, { statusCode: 404, message: 'Member not found in this group' });
    }

    // Auto members are in the room because one of the group's zones puts
    // them there — an approved member of the zone, one of its admins, or a
    // super admin. Removing the row would only last until the next
    // reconcile, so refuse and explain the actual lever.
    if (membership.source === 'auto') {
      return error(res, {
        statusCode: 409,
        code: 'MEMBER_IS_AUTOMATIC',
        message:
          'This person is in the group automatically because of the zones it '
          + 'covers, so they cannot be removed by hand. Detach the zone, or change '
          + 'their zone or role, if they should not be here.',
      });
    }

    await membership.destroy();

    // Notify room members
    emitMemberUpdate(groupId, 'member_removed', {
      group_id: groupId,
      user_id: userId,
      user_type,
    });

    const totalMembers = await ChatGroupMember.count({ where: { group_id: groupId } });

    return success(res, {
      statusCode: 200,
      message: 'Member removed',
      data: { group_id: groupId, total_members: totalMembers },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/chat/groups/:id
// Access: super_admin only
//
// Soft-deletes the group (sets is_active = false).
// Members can no longer see or message the group.
// ---------------------------------------------------------------------------
const deleteGroup = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    // Deleting a zone's own group would achieve nothing: the provisioner
    // recreates it on the next restart. Say so instead of pretending.
    if (group.is_default) {
      return error(res, {
        statusCode: 409,
        message:
          'This group belongs to a zone and cannot be deleted — every member of '
          + 'that zone is in it by definition. Remove the zone from the group '
          + 'first if you really want it gone.',
      });
    }

    await group.update({ is_active: false });

    // Notify all connected members that the group was deleted
    const { getIO } = require('../services/socketService');
    try {
      getIO().to(`group:${groupId}`).emit('group_deleted', { group_id: groupId });
    } catch {
      // Socket.IO may not be running in test environments — safe to ignore
    }

    return success(res, {
      statusCode: 200,
      message: 'Group deleted',
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/chat/zones
// Access: super_admin only
//
// Every active zone, with its member count and whether the given group
// already covers it. Feeds the "add a zone" picker.
// Query: ?group_id=<uuid>  (optional — marks which are already linked)
// ---------------------------------------------------------------------------
const listZones = async (req, res, next) => {
  try {
    const { group_id } = req.query;

    const zones = await Location.findAll({
      where: { type: 'zone', is_active: true },
      attributes: ['id', 'name'],
      order: [['name', 'ASC']],
    });

    let linked = new Set();
    if (group_id) {
      const links = await ChatGroupZone.findAll({
        where: { group_id },
        attributes: ['zone_location_id'],
      });
      linked = new Set(links.map((l) => l.zone_location_id));
    }

    // One zone index for the whole list rather than a tree walk per zone.
    const zoneIndex = await chatGroupSync.buildZoneIndex();
    const approved = await User.findAll({
      where: { status: 'approved' },
      attributes: ['id', 'location_id'],
    });
    const counts = new Map();
    for (const u of approved) {
      const zoneId = zoneIndex.get(u.location_id);
      if (zoneId) counts.set(zoneId, (counts.get(zoneId) || 0) + 1);
    }

    return success(res, {
      statusCode: 200,
      message: 'Zones fetched',
      data: {
        zones: zones.map((z) => ({
          id: z.id,
          name: z.name,
          member_count: counts.get(z.id) || 0,
          already_linked: linked.has(z.id),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/chat/groups/:id/zones
// Body: { zone_location_id }
// Access: super_admin only
//
// Attaches another zone to a group. Everyone in that zone — its approved
// members and its admins — joins immediately, and stays in sync from then on.
// ---------------------------------------------------------------------------
const addZone = async (req, res, next) => {
  try {
    const { id: groupId } = req.params;
    const { zone_location_id } = req.body || {};

    if (!zone_location_id) {
      return error(res, { statusCode: 400, message: 'zone_location_id is required' });
    }

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    // The FK only proves the row exists; "and it is a zone" has to be
    // checked here, because MySQL cannot constrain on a column's value.
    const zone = await Location.findByPk(zone_location_id);
    if (!zone || zone.type !== 'zone') {
      return error(res, { statusCode: 400, message: 'That location is not a zone' });
    }
    if (!zone.is_active) {
      return error(res, { statusCode: 400, message: `"${zone.name}" is no longer an active zone` });
    }

    const [, created] = await ChatGroupZone.findOrCreate({
      where: { group_id: groupId, zone_location_id },
      defaults: { group_id: groupId, zone_location_id },
    });
    if (!created) {
      return error(res, {
        statusCode: 409,
        message: `"${zone.name}" is already part of this group`,
      });
    }

    // Awaited, not backgrounded: the caller is about to re-render the member
    // list and should see the people who just joined.
    const result = await chatGroupSync.reconcileGroup(group);
    logger.info(
      `[chat] super_admin=${req.auth.id} added zone "${zone.name}" to group ${groupId} `
      + `(+${result.added} member(s))`
    );

    return success(res, {
      statusCode: 200,
      message: `${zone.name} added — ${result.added} member(s) joined.`,
      data: { group_id: groupId, zone: { id: zone.id, name: zone.name }, members_added: result.added },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/chat/groups/:id/zones/:zoneId
// Access: super_admin only
//
// Detaches a zone. Its members drop out unless another of the group's zones
// still covers them. A default group cannot lose its last zone — that would
// leave an orphan the provisioner would immediately re-create.
// ---------------------------------------------------------------------------
const removeZone = async (req, res, next) => {
  try {
    const { id: groupId, zoneId } = req.params;

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    const link = await ChatGroupZone.findOne({
      where: { group_id: groupId, zone_location_id: zoneId },
    });
    if (!link) {
      return error(res, { statusCode: 404, message: 'That zone is not part of this group' });
    }

    const remaining = await ChatGroupZone.count({ where: { group_id: groupId } });
    if (group.is_default && remaining <= 1) {
      return error(res, {
        statusCode: 409,
        message:
          'This group belongs to that zone — removing it would leave the zone '
          + 'without a chat. Add another zone first if you want to repurpose it.',
      });
    }

    await link.destroy();
    const result = await chatGroupSync.reconcileGroup(group);
    logger.info(
      `[chat] super_admin=${req.auth.id} removed zone ${zoneId} from group ${groupId} `
      + `(-${result.removed} member(s))`
    );

    return success(res, {
      statusCode: 200,
      message: `Zone removed — ${result.removed} member(s) left the group.`,
      data: { group_id: groupId, members_removed: result.removed },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/chat/admins
// Access: super_admin only
//
// Returns all active admins (name + phone + zone) for the group creation
// screen's member picker. Super admin uses this list to add admins to groups.
// ---------------------------------------------------------------------------
const listAdmins = async (req, res, next) => {
  try {
    const admins = await Admin.findAll({
      where: { is_active: true },
      attributes: ['id', 'name', 'phone', 'zone_location_id'],
      order: [['name', 'ASC']],
    });

    return success(res, {
      statusCode: 200,
      message: 'Admins fetched',
      data: { admins },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/chat/groups/:id/messages/:msgId/report
// Body: { reason?, block_sender? }
// Access: group members only
//
// Flags a message for moderation, and optionally blocks its sender in the
// same action — the two-things-one-tap shape the reference flow uses,
// because someone who has just been shown something abusive should not have
// to find a second screen to stop seeing it.
//
// WHAT GETS STORED, AND WHY A SNAPSHOT
// deleteMessage overwrites content with '[deleted]'. Storing only a message
// id would mean a reported sender could erase the evidence with two taps,
// and the moderator would open the queue to a blank row. The text and the
// sender's name are copied in here and never updated.
//
// The reported person is told nothing. No socket event, no push, no change
// they can observe — the reference flow's promise that "this person won't
// know you reported them" is a promise this endpoint has to keep.
// ---------------------------------------------------------------------------
const reportMessage = async (req, res, next) => {
  try {
    const { id: groupId, msgId } = req.params;
    const { reason, block_sender: blockSender } = req.body || {};
    const { actorId, actorType } = getActor(req.auth);

    const group = await ChatGroup.findOne({ where: { id: groupId, is_active: true } });
    if (!group) {
      return error(res, { statusCode: 404, message: 'Group not found' });
    }

    const membership = await ChatGroupMember.findOne({
      where: { group_id: groupId, user_id: actorId, user_type: actorType },
    });
    if (!membership) {
      return error(res, { statusCode: 403, message: 'You are not a member of this group' });
    }

    const message = await ChatMessage.findOne({ where: { id: msgId, group_id: groupId } });
    if (!message) {
      return error(res, { statusCode: 404, message: 'Message not found' });
    }

    // Reporting yourself is almost certainly a mis-tap, and it would put
    // noise in a queue that exists to surface real problems.
    if (message.sender_id === actorId && message.sender_type === actorType) {
      return error(res, {
        statusCode: 422,
        message: 'You cannot report your own message.',
      });
    }

    const senderProfile = await resolveProfile(message.sender_id, message.sender_type);

    // Idempotent: reporting twice is the same single report. The unique
    // index enforces it; this check is what turns a duplicate-key crash
    // into a calm "already reported".
    const existing = await ChatMessageReport.findOne({
      where: { message_id: message.id, reporter_id: actorId, reporter_type: actorType },
    });

    let report = existing;
    if (!existing) {
      report = await ChatMessageReport.create({
        message_id: message.id,
        group_id: groupId,
        reporter_id: actorId,
        reporter_type: actorType,
        reported_user_id: message.sender_id,
        reported_user_type: message.sender_type,
        reason: (reason || '').trim() || null,
        // Frozen evidence. If the message was already deleted before the
        // report, say so plainly rather than storing the '[deleted]'
        // placeholder as though it were what someone objected to.
        message_snapshot: message.is_deleted
          ? '[the sender deleted this message before it was reported]'
          : message.content,
        reported_user_name_snapshot: senderProfile?.name || null,
        reported_at: new Date(),
        status: 'pending',
      });
      logger.info(
        `[moderation] ${actorType}:${actorId} reported message ${message.id} `
        + `by ${message.sender_type}:${message.sender_id} in group ${groupId}`
      );
    }

    // Same action, both outcomes — see the note above.
    let blocked = false;
    if (blockSender) {
      const [, created] = await ChatUserBlock.findOrCreate({
        where: {
          blocker_id: actorId,
          blocker_type: actorType,
          blocked_id: message.sender_id,
          blocked_type: message.sender_type,
        },
        defaults: {
          blocker_id: actorId,
          blocker_type: actorType,
          blocked_id: message.sender_id,
          blocked_type: message.sender_type,
        },
      });
      blocked = true;
      if (created) {
        logger.info(
          `[moderation] ${actorType}:${actorId} blocked `
          + `${message.sender_type}:${message.sender_id}`
        );
      }
    }

    return success(res, {
      statusCode: existing ? 200 : 201,
      message: existing
        ? 'You have already reported this message. Our team is reviewing it.'
        : 'Report sent to our moderation team.',
      data: {
        report_id: report.id,
        already_reported: !!existing,
        blocked_sender: blocked,
        // Echoed so the client can say "you will no longer see messages
        // from X" without holding the name itself.
        sender_name: senderProfile?.name || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/chat/blocks
// Body: { user_id, user_type }
// Access: any authenticated member
//
// Block someone. One-way and silent — see the long note at the top of
// services/chatModerationService.js for why one-way rather than mutual.
//
// Idempotent: blocking someone already blocked returns 200, not a duplicate
// row and not an error.
// ---------------------------------------------------------------------------
const blockUser = async (req, res, next) => {
  try {
    const { user_id: targetId, user_type: targetType } = req.body || {};
    const { actorId, actorType } = getActor(req.auth);

    if (!targetId || !['user', 'admin', 'super_admin'].includes(targetType)) {
      return error(res, {
        statusCode: 400,
        message: 'user_id and a valid user_type are required.',
      });
    }

    if (targetId === actorId && targetType === actorType) {
      return error(res, { statusCode: 422, message: 'You cannot block yourself.' });
    }

    const profile = await resolveProfile(targetId, targetType);
    if (profile?.is_former_member) {
      return error(res, {
        statusCode: 404,
        message: 'That account no longer exists, so there is nothing to block.',
      });
    }

    const [, created] = await ChatUserBlock.findOrCreate({
      where: {
        blocker_id: actorId,
        blocker_type: actorType,
        blocked_id: targetId,
        blocked_type: targetType,
      },
      defaults: {
        blocker_id: actorId,
        blocker_type: actorType,
        blocked_id: targetId,
        blocked_type: targetType,
      },
    });

    if (created) {
      logger.info(`[moderation] ${actorType}:${actorId} blocked ${targetType}:${targetId}`);
    }

    return success(res, {
      statusCode: created ? 201 : 200,
      message: created
        ? `You will no longer see messages from ${profile.name}.`
        : `${profile.name} is already blocked.`,
      data: { blocked: true, user_id: targetId, user_type: targetType, name: profile.name },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/chat/blocks/:userId?user_type=user|admin|super_admin
// Access: any authenticated member
//
// Unblock. Their past messages reappear immediately on the next fetch —
// nothing was deleted, only hidden.
// ---------------------------------------------------------------------------
const unblockUser = async (req, res, next) => {
  try {
    const { userId: targetId } = req.params;
    const targetType = req.query.user_type;
    const { actorId, actorType } = getActor(req.auth);

    if (!['user', 'admin', 'super_admin'].includes(targetType)) {
      return error(res, {
        statusCode: 400,
        message: 'user_type query parameter is required (user, admin, or super_admin).',
      });
    }

    const removed = await ChatUserBlock.destroy({
      where: {
        blocker_id: actorId,
        blocker_type: actorType,
        blocked_id: targetId,
        blocked_type: targetType,
      },
    });

    // Idempotent: unblocking someone who was not blocked is a no-op with a
    // 200, not a 404 — the caller's intent is satisfied either way.
    return success(res, {
      statusCode: 200,
      message: removed ? 'Unblocked. Their messages are visible again.' : 'They were not blocked.',
      data: { unblocked: removed > 0 },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/chat/blocks
// Access: any authenticated member
//
// The caller's own blocked list, for the management screen. Also read by
// the client at chat-room mount so live socket messages from a blocked
// sender can be dropped before render — history is already filtered
// server-side, but a room broadcast has no per-recipient view.
// ---------------------------------------------------------------------------
const listBlockedUsers = async (req, res, next) => {
  try {
    const { actorId, actorType } = getActor(req.auth);

    const rows = await ChatUserBlock.findAll({
      where: { blocker_id: actorId, blocker_type: actorType },
      order: [['created_at', 'DESC']],
    });

    const blocked = await Promise.all(
      rows.map(async (r) => {
        const profile = await resolveProfile(r.blocked_id, r.blocked_type);
        return {
          user_id: r.blocked_id,
          user_type: r.blocked_type,
          name: profile?.name || FORMER_MEMBER_LABEL,
          is_former_member: !!profile?.is_former_member,
          blocked_at: r.created_at,
        };
      })
    );

    return success(res, {
      statusCode: 200,
      message: 'Blocked users fetched',
      data: { blocked, total: blocked.length },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  // Trust & safety
  reportMessage,
  blockUser,
  unblockUser,
  listBlockedUsers,
  listZones,
  addZone,
  removeZone,
  getMyGroups,
  createGroup,
  getGroupDetails,
  getMessages,
  sendMessage,
  deleteMessage,
  markAsRead,
  addMembers,
  removeMember,
  deleteGroup,
  listAdmins,
};
