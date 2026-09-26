'use strict';

/**
 * chatModerationController.js — the moderation queue.
 *
 * Both stores require more than a report button: they require the operator
 * to be able to act on what gets reported. This is that mechanism.
 *
 * SCOPE — admins see their own zone, super admins see everything.
 * Chat groups are zone-backed (chat_group_zones), and a zone's admin is
 * already auto-added to its room by chatGroupSync, so they are a person who
 * is actually present when something happens. Scoping this way also matches
 * how donations and feedback already work, and it means a report at 2am has
 * more than one person who can act on it.
 */

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { FORMER_MEMBER_LABEL } = require('../utils/memberDisplay');
const moderation = require('../services/chatModerationService');
const logger = require('../utils/logger');
const { emitMessageDeleted } = require('../services/socketService');

const {
  ChatMessageReport, ChatMessage, ChatGroup, ChatGroupMember,
  User, Admin, SuperAdmin,
} = db;

/** Resolve one polymorphic identity to a display profile. */
const resolveProfile = async (id, type) => {
  let record = null;
  if (type === 'user') record = await User.findByPk(id, { attributes: ['id', 'name', 'phone'] });
  else if (type === 'admin') record = await Admin.findByPk(id, { attributes: ['id', 'name', 'phone'] });
  else if (type === 'super_admin') record = await SuperAdmin.findByPk(id, { attributes: ['id', 'name', 'phone'] });
  if (!record) return { id, name: FORMER_MEMBER_LABEL, phone: null, role: type, is_former_member: true };
  return { id: record.id, name: record.name, phone: record.phone, role: type };
};

// ---------------------------------------------------------------------------
// GET /api/admin/chat/reports
// Query: ?status=pending|reviewed|all  &page=1&limit=20
// Access: admin (own zone's groups) | super_admin (everything)
//
// Pending first by default, because the queue's job is to show outstanding
// work rather than a complete history.
// ---------------------------------------------------------------------------
const listReports = async (req, res, next) => {
  try {
    const status = ['pending', 'reviewed', 'all'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // null = super admin, see everything. An array = the groups this
    // admin's zone covers; an empty array correctly yields an empty queue
    // rather than silently widening to the whole community.
    const groupFilter = await moderation.moderatableGroupFilter(req.auth);
    if (Array.isArray(groupFilter) && groupFilter.length === 0) {
      return success(res, {
        statusCode: 200,
        message: 'No chat groups are in your zone.',
        data: { reports: [], total: 0, pending_count: 0, page, limit },
      });
    }

    const where = {
      ...(status === 'all' ? {} : { status }),
      ...(groupFilter ? { group_id: { [Op.in]: groupFilter } } : {}),
    };

    const [{ count, rows }, pendingCount] = await Promise.all([
      ChatMessageReport.findAndCountAll({
        where,
        include: [{ model: ChatGroup, as: 'group', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']],
        limit,
        offset,
      }),
      ChatMessageReport.count({
        where: {
          status: 'pending',
          ...(groupFilter ? { group_id: { [Op.in]: groupFilter } } : {}),
        },
      }),
    ]);

    const reports = await Promise.all(rows.map(async (r) => {
      const [reporter, reported, reviewer] = await Promise.all([
        resolveProfile(r.reporter_id, r.reporter_type),
        resolveProfile(r.reported_user_id, r.reported_user_type),
        r.reviewed_by ? resolveProfile(r.reviewed_by, r.reviewed_by_type) : null,
      ]);

      // Live state of the thing complained about, alongside the frozen
      // snapshot. A moderator needs both: the snapshot is what was
      // reported, the live row says whether it is still standing.
      const live = r.message_id
        ? await ChatMessage.findByPk(r.message_id, { attributes: ['id', 'is_deleted'] })
        : null;

      const membership = await ChatGroupMember.findOne({
        where: {
          group_id: r.group_id,
          user_id: r.reported_user_id,
          user_type: r.reported_user_type,
        },
        attributes: ['id', 'is_banned'],
      });

      // How many times this person has been reported anywhere. One report
      // is an incident; five is a pattern, and the difference should be
      // visible without the moderator running their own search.
      const priorReports = await ChatMessageReport.count({
        where: { reported_user_id: r.reported_user_id, reported_user_type: r.reported_user_type },
      });

      return {
        id: r.id,
        group: r.group ? { id: r.group.id, name: r.group.name } : { id: r.group_id, name: 'Unknown group' },
        reporter,
        reported_user: {
          ...reported,
          // The snapshot wins when the account has since been erased, so
          // the queue still says who it was.
          name: reported.is_former_member && r.reported_user_name_snapshot
            ? r.reported_user_name_snapshot
            : reported.name,
        },
        reason: r.reason,
        message_snapshot: r.message_snapshot,
        message_id: r.message_id,
        message_still_visible: live ? !live.is_deleted : false,
        message_exists: !!live,
        reported_user_banned: !!membership?.is_banned,
        reported_user_in_group: !!membership,
        total_reports_against_user: priorReports,
        status: r.status,
        action_taken: r.action_taken,
        review_note: r.review_note,
        reviewed_by: reviewer,
        reviewed_at: r.reviewed_at,
        reported_at: r.reported_at,
        created_at: r.created_at,
      };
    }));

    return success(res, {
      statusCode: 200,
      message: 'Reports fetched',
      data: { reports, total: count, pending_count: pendingCount, page, limit },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/admin/chat/reports/:id
// Body: { delete_message?: bool, ban_user?: bool, note?: string }
// Access: admin (own zone's groups) | super_admin
//
// Resolve a report, optionally acting. Sending neither flag marks it
// reviewed with no action, which is a real and common outcome — most
// reports of a heated exchange are not abuse, and the queue needs a way to
// record "looked at, nothing to do" that is distinct from "untouched".
//
// WHY BAN AND NOT REMOVE
// Removing a member does not stick. A zone-backed group auto-adds every
// approved member of its zones and chatGroupSync reconciles continuously,
// so a deleted membership row is restored on the next pass — quietly, and
// within seconds. The row stays and is marked banned instead: they keep
// reading the room, they cannot post, and the reconciler leaves it alone.
// ---------------------------------------------------------------------------
const resolveReport = async (req, res, next) => {
  const t = await db.sequelize.transaction();
  try {
    const { id } = req.params;
    const { delete_message: deleteMessage, ban_user: banUser, note } = req.body || {};

    const report = await ChatMessageReport.findByPk(id, { transaction: t });
    if (!report) {
      await t.rollback();
      return error(res, { statusCode: 404, message: 'Report not found' });
    }

    const allowed = await moderation.canModerateGroup(req.auth, report.group_id);
    if (!allowed) {
      await t.rollback();
      return error(res, {
        statusCode: 403,
        message: 'That report is for a group outside your zone.',
      });
    }

    let messageDeleted = false;
    let userBanned = false;

    // ---- delete the reported message -------------------------------
    if (deleteMessage && report.message_id) {
      const msg = await ChatMessage.findByPk(report.message_id, { transaction: t });
      if (msg && !msg.is_deleted) {
        // Same soft-delete the owner path uses: the row survives so reply
        // threads pointing at it do not break, and every client already
        // renders is_deleted as "This message was deleted".
        await msg.update({ is_deleted: true, content: '[deleted]' }, { transaction: t });
        messageDeleted = true;
      } else if (msg?.is_deleted) {
        // Already gone — treat as satisfied rather than an error, since
        // the sender deleting it first is the common case.
        messageDeleted = true;
      }
    }

    // ---- ban the reported member from this group --------------------
    if (banUser) {
      const membership = await ChatGroupMember.findOne({
        where: {
          group_id: report.group_id,
          user_id: report.reported_user_id,
          user_type: report.reported_user_type,
        },
        transaction: t,
      });
      if (!membership) {
        await t.rollback();
        return error(res, {
          statusCode: 404,
          message: 'That member is no longer in the group, so there is nothing to ban.',
        });
      }
      // A super admin is the moderation backstop; letting a zone admin
      // silence one would be a way to disable oversight from inside.
      if (report.reported_user_type === 'super_admin' && req.auth.role !== 'super_admin') {
        await t.rollback();
        return error(res, {
          statusCode: 403,
          message: 'Only another super admin can ban a super admin.',
        });
      }
      if (!membership.is_banned) {
        await membership.update({
          is_banned: true,
          banned_at: new Date(),
          banned_by: req.auth.id,
          ban_reason: (note || '').trim().slice(0, 500) || 'Reported for abusive content',
        }, { transaction: t });
      }
      userBanned = true;
    }

    const action = messageDeleted && userBanned ? 'both'
      : messageDeleted ? 'message_deleted'
        : userBanned ? 'user_banned'
          : 'none';

    await report.update({
      status: 'reviewed',
      action_taken: action,
      reviewed_by: req.auth.id,
      reviewed_by_type: req.auth.role,
      reviewed_at: new Date(),
      review_note: (note || '').trim() || null,
    }, { transaction: t });

    // Everyone else who reported the SAME message is resolved too. Five
    // people flagging one message is one piece of work, and leaving four
    // rows pending would make the queue lie about how much is outstanding.
    let alsoResolved = 0;
    if (report.message_id) {
      const [n] = await ChatMessageReport.update(
        {
          status: 'reviewed',
          action_taken: action,
          reviewed_by: req.auth.id,
          reviewed_by_type: req.auth.role,
          reviewed_at: new Date(),
          review_note: (note || '').trim() || null,
        },
        {
          where: {
            message_id: report.message_id,
            status: 'pending',
            id: { [Op.ne]: report.id },
          },
          transaction: t,
        }
      );
      alsoResolved = n;
    }

    await t.commit();

    // Outside the transaction: a socket emit cannot be rolled back, so it
    // must not fire until the write is certain.
    if (messageDeleted && report.message_id) {
      try {
        emitMessageDeleted(report.group_id, report.message_id);
      } catch (e) {
        logger.warn(`[moderation] emitMessageDeleted failed: ${e.message}`);
      }
    }

    logger.info(
      `[moderation] ${req.auth.role}:${req.auth.id} resolved report ${report.id} `
      + `action=${action}${alsoResolved ? ` (+${alsoResolved} duplicate report(s))` : ''}`
    );

    const parts = [];
    if (messageDeleted) parts.push('message deleted');
    if (userBanned) parts.push('member can no longer post in this group');

    return success(res, {
      statusCode: 200,
      message: parts.length ? `Report resolved — ${parts.join('; ')}.` : 'Report marked reviewed.',
      data: {
        id: report.id,
        status: 'reviewed',
        action_taken: action,
        message_deleted: messageDeleted,
        user_banned: userBanned,
        also_resolved: alsoResolved,
      },
    });
  } catch (err) {
    try { await t.rollback(); } catch (_) { /* already settled */ }
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/admin/chat/groups/:groupId/bans/:userId?user_type=...
// Access: admin (own zone) | super_admin
//
// Lift a ban. Bans are a judgement call made quickly, at night, on partial
// information — one that cannot be undone is one moderators will hesitate
// to use when they should.
// ---------------------------------------------------------------------------
const liftBan = async (req, res, next) => {
  try {
    const { groupId, userId } = req.params;
    const userType = req.query.user_type;

    if (!['user', 'admin', 'super_admin'].includes(userType)) {
      return error(res, {
        statusCode: 400,
        message: 'user_type query parameter is required (user, admin, or super_admin).',
      });
    }

    const allowed = await moderation.canModerateGroup(req.auth, groupId);
    if (!allowed) {
      return error(res, { statusCode: 403, message: 'That group is outside your zone.' });
    }

    const membership = await moderation.membershipOf(groupId, userId, userType);
    if (!membership) {
      return error(res, { statusCode: 404, message: 'That member is not in the group.' });
    }
    if (!membership.is_banned) {
      return success(res, {
        statusCode: 200,
        message: 'That member is not banned.',
        data: { lifted: false },
      });
    }

    await membership.update({
      is_banned: false, banned_at: null, banned_by: null, ban_reason: null,
    });

    logger.info(`[moderation] ${req.auth.role}:${req.auth.id} lifted ban on ${userType}:${userId} in group ${groupId}`);

    return success(res, {
      statusCode: 200,
      message: 'Ban lifted. They can post in this group again.',
      data: { lifted: true },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/admin/chat/bans
// Access: admin (own zone) | super_admin
//
// Everyone currently banned, so a ban is not something that quietly stays
// in force for a year because nobody remembered it was there.
// ---------------------------------------------------------------------------
const listBans = async (req, res, next) => {
  try {
    const groupFilter = await moderation.moderatableGroupFilter(req.auth);
    if (Array.isArray(groupFilter) && groupFilter.length === 0) {
      return success(res, {
        statusCode: 200, message: 'No chat groups are in your zone.', data: { bans: [] },
      });
    }

    const rows = await ChatGroupMember.findAll({
      where: {
        is_banned: true,
        ...(groupFilter ? { group_id: { [Op.in]: groupFilter } } : {}),
      },
      include: [{ model: ChatGroup, as: 'group', attributes: ['id', 'name'] }],
      order: [['banned_at', 'DESC']],
    });

    const bans = await Promise.all(rows.map(async (m) => ({
      group: m.group ? { id: m.group.id, name: m.group.name } : { id: m.group_id, name: 'Unknown group' },
      user: await resolveProfile(m.user_id, m.user_type),
      user_type: m.user_type,
      banned_at: m.banned_at,
      ban_reason: m.ban_reason,
    })));

    return success(res, {
      statusCode: 200,
      message: 'Bans fetched',
      data: { bans, total: bans.length },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listReports,
  resolveReport,
  liftBan,
  listBans,
};
