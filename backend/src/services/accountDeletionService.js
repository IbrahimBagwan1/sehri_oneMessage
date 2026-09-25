'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');

const {
  User, Admin, SuperAdmin, Rider,
  PollResponse, Poll, Donation, Feedback, ProfileEditRequest,
  ChatGroupMember, ChatMessage, OTP,
} = db;

/**
 * accountDeletionService — erasing a member, for real.
 *
 * WHY THIS EXISTS
 * The previous implementation soft-deleted: it rewrote the users row's
 * phone to `DEL-xxxx-<timestamp>`, set status='deleted', and flipped any
 * linked admin / super_admin / rider row to `is_active = false`. Two
 * things went wrong with that, and both were reported as bugs:
 *
 *   1. It never touched the PHONE on those privileged rows. The number
 *      stayed in `admins`/`super_admins`/`riders`, so login still found
 *      an account for it and — because the row was now inactive —
 *      answered "This account has been deactivated". The person had
 *      deleted their account and was told it was suspended.
 *   2. Registration's phone-uniqueness check looks across all four
 *      account tables, so the same leftover row reported "already
 *      registered" and the number could never be reused.
 *
 * WHAT DELETION MEANS NOW
 * The person is gone; the community's record of what happened is not.
 * Per table:
 *
 *   users                  DELETE. There is no tombstone, no status flag,
 *                          nothing left holding the phone number.
 *   admins / super_admins   DELETE. No table has a foreign key to them
 *   riders                  (verified against information_schema), so the
 *                          rows come out cleanly. This is also what a
 *                          super admin's own "delete rider" button
 *                          already does.
 *   poll_responses         SPLIT — see below.
 *   donations              KEEP, user_id → NULL. Financial records the
 *                          community reconciles against.
 *   feedback               KEEP, user_id → NULL. An open complaint must
 *                          not vanish from the admin inbox mid-review.
 *   profile_edit_requests  DELETE. Pure PII (a proposed name / address),
 *                          zero historical value. The FK already
 *                          cascades; we delete explicitly so the intent
 *                          is readable here rather than only in the DDL.
 *   chat_group_members     DELETE. They leave every group they were in.
 *   chat_messages          is_deleted = true. Their words are erased but
 *                          the row stays, so reply threads don't break —
 *                          the same mechanism the app already uses for
 *                          "This message was deleted".
 *   otps                   DELETE. Stale one-time codes tied to a number
 *                          that is about to become available again.
 *
 * THE POLL_RESPONSES SPLIT
 * A response to a poll dated in the PAST is history: it stays, with
 * user_id set to NULL. Nothing is lost, because `poll_responses.zone` is
 * snapshotted at vote time (see the model) and every aggregate in
 * pollController / pollController2 groups on (poll_id, zone, response)
 * without joining users. The counts stay byte-for-byte identical.
 *
 * A response to a poll dated TODAY OR LATER is not history — it's a
 * pending obligation. Leaving it would tell the kitchen to cook a packet
 * for someone who no longer exists and hand the rider a stop they can
 * never complete (the delivery list resolves the destination through
 * `user.location_id`, which is about to be NULL). Those rows are
 * deleted, which is also what withdrawing from the poll would have done.
 */

/** Today's date in IST as YYYY-MM-DD — the poll calendar's own key. */
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** "9141687582" → "91*****582" for logs. Never log a number in full. */
const maskPhone = (phone) => {
  if (typeof phone !== 'string' || phone.length < 6) return '******';
  return `${phone.slice(0, 2)}${'*'.repeat(phone.length - 5)}${phone.slice(-3)}`;
};

/**
 * Every account row that belongs to this person.
 *
 * Matched on `user_id = <id> OR phone = <phone>`, not on the link alone.
 * A zone admin promoted before the user_id column existed — or created
 * directly by a super admin — has no link but is unmistakably the same
 * person, and it is exactly those unlinked rows that were keeping the
 * phone number hostage.
 */
const findLinkedAccounts = async (user, transaction) => {
  const match = { [Op.or]: [{ user_id: user.id }, { phone: user.phone }] };
  const [admins, superAdmins, riders] = await Promise.all([
    Admin.findAll({ where: match, transaction }),
    SuperAdmin.findAll({ where: match, transaction }),
    Rider.findAll({ where: match, transaction }),
  ]);
  return { admins, superAdmins, riders };
};

/**
 * Erase a member and everything that identifies them.
 *
 * Returns one of:
 *   { notFound: true }
 *   { blocked: 'LAST_SUPER_ADMIN' }
 *   { deleted: true, removed: { ... } }
 *
 * The whole thing runs in one transaction: either the person is gone and
 * the history is detached, or nothing moved.
 */
const eraseUserAccount = async (userId) => {
  const t = await db.sequelize.transaction();
  try {
    const user = await User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!user) {
      await t.rollback();
      return { notFound: true };
    }

    const phone = user.phone;
    const linked = await findLinkedAccounts(user, t);

    // GUARD — never let the community lock itself out of administration.
    // Counted inside the transaction so two concurrent deletes can't each
    // see "one other super admin still active" and both go through.
    if (linked.superAdmins.length > 0) {
      const doomedIds = linked.superAdmins.map((sa) => sa.id);
      const survivors = await SuperAdmin.count({
        where: { id: { [Op.notIn]: doomedIds }, is_active: true },
        transaction: t,
      });
      if (survivors === 0) {
        await t.rollback();
        return { blocked: 'LAST_SUPER_ADMIN' };
      }
    }

    // --- poll_responses: keep the past, withdraw from the present ------
    const today = todayIST();
    const pendingPolls = await Poll.findAll({
      where: { date: { [Op.gte]: today } },
      attributes: ['id'],
      transaction: t,
    });
    const pendingPollIds = pendingPolls.map((p) => p.id);

    let withdrawnVotes = 0;
    if (pendingPollIds.length > 0) {
      withdrawnVotes = await PollResponse.destroy({
        where: { user_id: userId, poll_id: { [Op.in]: pendingPollIds } },
        transaction: t,
      });
    }
    const [keptVotes] = await PollResponse.update(
      { user_id: null },
      { where: { user_id: userId }, transaction: t }
    );

    // --- records that outlive the person, detached from them -----------
    const [keptDonations] = await Donation.update(
      { user_id: null },
      { where: { user_id: userId }, transaction: t }
    );
    const [keptFeedback] = await Feedback.update(
      { user_id: null },
      { where: { user_id: userId }, transaction: t }
    );

    // --- records that are nothing but the person ------------------------
    await ProfileEditRequest.destroy({ where: { user_id: userId }, transaction: t });

    // Chat is polymorphic (user_id/sender_id + a *_type discriminator) and
    // has no FK to users, so every identity this person held has to be
    // swept by hand.
    const identities = [
      { id: userId, type: 'user' },
      ...linked.admins.map((a) => ({ id: a.id, type: 'admin' })),
      ...linked.superAdmins.map((sa) => ({ id: sa.id, type: 'super_admin' })),
    ];
    for (const { id, type } of identities) {
      await ChatGroupMember.destroy({
        where: { user_id: id, user_type: type },
        transaction: t,
      });
      await ChatMessage.update(
        { is_deleted: true },
        { where: { sender_id: id, sender_type: type, is_deleted: false }, transaction: t }
      );
    }

    await OTP.destroy({ where: { phone }, transaction: t });

    // --- the account rows themselves ------------------------------------
    // A rider assigned to a poll is referenced by polls.assigned_rider_id,
    // which is ON DELETE SET NULL — but clearing it explicitly keeps the
    // poll's own audit trail honest about when the assignment went away.
    for (const rider of linked.riders) {
      await Poll.update(
        { assigned_rider_id: null },
        { where: { assigned_rider_id: rider.id }, transaction: t }
      );
    }
    for (const row of [...linked.admins, ...linked.superAdmins, ...linked.riders]) {
      await row.destroy({ transaction: t });
    }

    await user.destroy({ transaction: t });
    await t.commit();

    const removed = {
      admin_rows:       linked.admins.length,
      super_admin_rows: linked.superAdmins.length,
      rider_rows:       linked.riders.length,
      votes_withdrawn:  withdrawnVotes,
      votes_kept:       keptVotes,
      donations_kept:   keptDonations,
      feedback_kept:    keptFeedback,
    };
    logger.info(
      `[accounts] Erased user ${userId} (phone ${maskPhone(phone)}) — ` +
      `staff rows removed a:${removed.admin_rows} sa:${removed.super_admin_rows} r:${removed.rider_rows}; ` +
      `votes withdrawn:${removed.votes_withdrawn} kept:${removed.votes_kept}; ` +
      `donations kept:${removed.donations_kept}; feedback kept:${removed.feedback_kept}`
    );
    return { deleted: true, removed };
  } catch (err) {
    try { await t.rollback(); } catch (_) { /* already released */ }
    logger.error(`[accounts] eraseUserAccount(${userId}) failed: ${err.name}: ${err.message}`);
    throw err;
  }
};

module.exports = {
  eraseUserAccount,
  // exported for the maintenance script and for tests
  findLinkedAccounts,
  maskPhone,
};
