'use strict';

/**
 * Makes a user account genuinely erasable.
 *
 * BEFORE: deleting an account was a soft delete — the users row survived
 * with status='deleted' and a `DEL-xxxx-<ts>` placeholder phone. That row
 * existed only because three foreign keys made a real DELETE impossible:
 *
 *   poll_responses.user_id  NOT NULL  ON DELETE CASCADE   → would have
 *       silently destroyed the community's vote history along with the
 *       person, which is the one thing we must keep.
 *   donations.user_id       NOT NULL  ON DELETE RESTRICT  → would have
 *       thrown, blocking the delete outright.
 *   feedback.user_id        NOT NULL  ON DELETE RESTRICT  → same.
 *
 * AFTER: all three become nullable with ON DELETE SET NULL, so the row
 * that records *what happened* outlives the person it happened to:
 *
 *   • poll_responses already snapshots `zone` at vote time (see the model
 *     comment) precisely so kitchen counts never depend on the live user
 *     row. Nulling user_id therefore loses nothing an aggregate reads —
 *     every count in pollController / pollController2 groups on
 *     (poll_id, zone, response) with no join to users.
 *   • donations are a financial record the community reconciles against.
 *   • feedback is an admin inbox item that stays actionable once the
 *     sender's identity is gone.
 *
 * profile_edit_requests is deliberately left ON DELETE CASCADE: those rows
 * are nothing but a proposed name / address / location change — pure PII
 * with no historical value. They should vanish with the person.
 *
 * The migration then purges every legacy soft-deleted row and removes
 * 'deleted' from the users.status ENUM, so the state that caused the bug
 * becomes unrepresentable rather than merely unused.
 *
 * ORDER MATTERS: the FK rules are converted BEFORE the purge, otherwise
 * deleting the legacy rows would cascade their poll_responses away.
 */

// The referencing columns are CHAR(36) utf8mb4_bin (Sequelize's UUID on
// MySQL). The charset/collation must be restated verbatim on MODIFY or
// the re-added FK fails with a collation mismatch against users.id.
const UUID_COL = 'CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin';

/** [table, constraint name] for the three FKs we are relaxing. */
const RELAXED = [
  ['poll_responses', 'poll_responses_ibfk_2'],
  ['donations',      'donations_ibfk_1'],
  ['feedback',       'feedback_ibfk_1'],
];

/** The delete rule each one had before, for a faithful rollback. */
const ORIGINAL_DELETE_RULE = {
  poll_responses: 'CASCADE',
  donations:      'RESTRICT',
  feedback:       'RESTRICT',
};

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);

    // 1. Relax the three blocking foreign keys.
    for (const [table, constraint] of RELAXED) {
      await q(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${constraint}\`;`);
      await q(`ALTER TABLE \`${table}\` MODIFY COLUMN \`user_id\` ${UUID_COL} NULL;`);
      await q(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` ` +
        'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ' +
        'ON DELETE SET NULL ON UPDATE CASCADE;'
      );
    }

    // 2. Purge the legacy soft-deleted rows. Their chat footprint has no
    //    FK to users, so it has to be cleaned by hand — the same two
    //    statements the runtime delete flow uses.
    await q(
      "DELETE m FROM `chat_group_members` m " +
      "JOIN `users` u ON u.id = m.user_id AND m.user_type = 'user' " +
      "WHERE u.status = 'deleted';"
    );
    await q(
      'UPDATE `chat_messages` msg ' +
      "JOIN `users` u ON u.id = msg.sender_id AND msg.sender_type = 'user' " +
      "SET msg.is_deleted = 1 WHERE u.status = 'deleted';"
    );
    // Anonymized rows carry a `DEL-...` placeholder phone, so there is no
    // real number left to match in `otps` — nothing to purge there.
    await q("DELETE FROM `users` WHERE `status` = 'deleted';");

    // 3. Make the state unrepresentable. Anything still writing 'deleted'
    //    now fails loudly instead of re-creating the ghost accounts.
    await q(
      'ALTER TABLE `users` MODIFY COLUMN `status` ' +
      "ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending';"
    );
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);

    await q(
      'ALTER TABLE `users` MODIFY COLUMN `status` ' +
      "ENUM('pending','approved','rejected','deleted') NOT NULL DEFAULT 'pending';"
    );

    // Restoring NOT NULL means the detached history rows cannot survive.
    // This rollback is a dev-environment convenience, not a production
    // escape hatch — it destroys the very records the `up` preserved.
    for (const [table, constraint] of RELAXED) {
      await q(`DELETE FROM \`${table}\` WHERE \`user_id\` IS NULL;`);
      await q(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${constraint}\`;`);
      await q(`ALTER TABLE \`${table}\` MODIFY COLUMN \`user_id\` ${UUID_COL} NOT NULL;`);
      await q(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraint}\` ` +
        'FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ' +
        `ON DELETE ${ORIGINAL_DELETE_RULE[table]} ON UPDATE CASCADE;`
      );
    }
  },
};
