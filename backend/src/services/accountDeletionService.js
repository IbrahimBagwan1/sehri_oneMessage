'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');
const cloudinaryService = require('./cloudinaryService');
const authSessionService = require('./authSessionService');
const { FORMER_MEMBER_LABEL } = require('../utils/memberDisplay');

const {
  User, Admin, SuperAdmin, Rider,
  PollResponse, Poll, Donation, Feedback, ProfileEditRequest,
  ChatGroupMember, ChatMessage, ChatUserBlock, ChatMessageReport,
  OTP, LoginThrottle,
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
 *   donations              KEEP amount / status / dates, user_id → NULL.
 *                          The payment SCREENSHOT is deleted from
 *                          Cloudinary and the free-text note cleared:
 *                          a UPI screenshot shows the payer's name and
 *                          handle, which is exactly the identifying data
 *                          erasure promises to remove. The ledger row
 *                          (what was given, when, verified or not) stays.
 *   feedback               KEEP, user_id → NULL. An open complaint must
 *                          not vanish from the admin inbox mid-review.
 *   profile_edit_requests  DELETE. Pure PII (a proposed name / address),
 *                          zero historical value. The FK already
 *                          cascades; we delete explicitly so the intent
 *                          is readable here rather than only in the DDL.
 *   chat_group_members     DELETE. They leave every group they were in.
 *   chat_messages          is_deleted = true AND content → '[deleted]'.
 *                          The row stays so reply threads don't break —
 *                          the same mechanism as "This message was
 *                          deleted" — but the words are gone from the
 *                          database, not just hidden. (The first version
 *                          only set the flag, which hid the text from
 *                          clients while keeping it in the table.)
 *   chat_user_blocks       DELETE, both directions.
 *   chat_message_reports   KEEP as a safety record (the privacy policy
 *                          says moderation records are retained), but the
 *                          reported person's NAME snapshot becomes
 *                          "Former member", and any still-pending report
 *                          about them is closed: there is no one left to
 *                          act against.
 *   auth_sessions          REVOKED — every device signed in as any of
 *                          this person's identities is signed out.
 *   otps, login_throttles  DELETE. State tied to a number that is about to
 *                          become available again.
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

const { istDateString } = require('../utils/istTime');

/** Today's date in IST as YYYY-MM-DD — the poll calendar's own key. */
const todayIST = () => istDateString();

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
    // The detach happens further down, after the screenshots are collected;
    // counting here keeps the summary line honest.
    const keptDonations = await Donation.count({ where: { user_id: userId }, transaction: t });
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
      // Overwrite the text, not just flag it — see the table above.
      await ChatMessage.update(
        { is_deleted: true, content: '[deleted]' },
        { where: { sender_id: id, sender_type: type }, transaction: t }
      );
      await ChatUserBlock.destroy({
        where: {
          [Op.or]: [
            { blocker_id: id, blocker_type: type },
            { blocked_id: id, blocked_type: type },
          ],
        },
        transaction: t,
      });
      await ChatMessageReport.update(
        { reported_user_name_snapshot: FORMER_MEMBER_LABEL },
        { where: { reported_user_id: id, reported_user_type: type }, transaction: t }
      );
      await ChatMessageReport.update(
        {
          status: 'reviewed',
          action_taken: 'none',
          reviewed_at: new Date(),
          review_note: 'Closed automatically: the reported member deleted their account.',
        },
        { where: { reported_user_id: id, reported_user_type: type, status: 'pending' }, transaction: t }
      );
    }

    // Payment screenshots are identifying (payer name, UPI handle). Collected
    // here, deleted from Cloudinary only after the transaction commits, so a
    // rollback never leaves a donation pointing at a file that is gone.
    const donationsWithScreenshots = await Donation.findAll({
      where: { user_id: userId, screenshot_url: { [Op.ne]: null } },
      attributes: ['id', 'screenshot_url'],
      transaction: t,
    });
    const screenshotIds = donationsWithScreenshots
      .map((d) => cloudinaryService.publicIdFromUrl(d.screenshot_url))
      .filter(Boolean);

    await OTP.destroy({ where: { phone }, transaction: t });
    await LoginThrottle.destroy({ where: { phone }, transaction: t });

    // Every session for every identity this person held, signed out.
    await authSessionService.revokeSubjects(
      [
        ...identities,
        ...linked.riders.map((r) => ({ id: r.id, type: 'rider' })),
      ],
      'account_deleted',
      { transaction: t }
    );

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

    await Donation.update(
      { user_id: null, screenshot_url: null, note: null },
      { where: { user_id: userId }, transaction: t }
    );

    await user.destroy({ transaction: t });
    await t.commit();

    // After commit: files and live connections are outside the transaction.
    for (const publicId of screenshotIds) {
      await cloudinaryService.deleteImage(publicId);
    }
    try {
      require('./socketService').disconnectUsers([
        userId,
        ...linked.admins.map((a) => a.id),
        ...linked.superAdmins.map((sa) => sa.id),
        ...linked.riders.map((r) => r.id),
      ]);
    } catch (_) { /* socket layer not running (scripts, tests) */ }

    const removed = {
      admin_rows:       linked.admins.length,
      super_admin_rows: linked.superAdmins.length,
      rider_rows:       linked.riders.length,
      votes_withdrawn:  withdrawnVotes,
      votes_kept:       keptVotes,
      donations_kept:   keptDonations,
      screenshots_deleted: screenshotIds.length,
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
