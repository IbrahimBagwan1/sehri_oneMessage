'use strict';

/**
 * Trust and safety for group chat: reporting a message, blocking a person,
 * and a moderation queue for acting on both.
 *
 * Google Play and the App Store both require an app carrying user-generated
 * messaging to offer in-app reporting, in-app blocking, and a way for the
 * operator to act on reports. This migration adds the storage for all three.
 *
 * THREE DESIGN POINTS WORTH THE COMMENT
 *
 * 1. The report carries a SNAPSHOT of what was reported.
 *    chatController.deleteMessage overwrites content with '[deleted]' when a
 *    message is soft-deleted. So the obvious design — store a message id and
 *    join to it at review time — loses the evidence the moment the sender
 *    deletes their own message, which is exactly what someone who has just
 *    been reported does. The reported text and the reporter's name for the
 *    sender are copied in at report time and never touched again.
 *
 * 2. Everyone is polymorphic (id + type), matching chat_messages.sender_id /
 *    sender_type and chat_group_members.user_id / user_type. A reporter, a
 *    reported person, and a reviewer can each be a user, an admin, or a
 *    super admin, living in three different tables. So no foreign keys on
 *    those columns — the same trade the chat tables already make.
 *
 * 3. Moderation BANS rather than removes.
 *    A zone-backed group auto-adds every approved member of its zones, and
 *    services/chatGroupSync.js reconciles that continuously. Deleting a
 *    membership row for an abusive member would be undone by the next
 *    reconcile — within seconds on a busy night, and silently. So the
 *    membership row stays and carries is_banned; the reconciler preserves
 *    it, and sendMessage refuses. That is a moderation action that actually
 *    holds, which is the whole point of the store requirement.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // -----------------------------------------------------------------
    // 1. chat_user_blocks — "I do not want to see this person"
    // -----------------------------------------------------------------
    await queryInterface.createTable('chat_user_blocks', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      blocker_id:   { type: Sequelize.UUID, allowNull: false },
      blocker_type: { type: Sequelize.ENUM('user', 'admin', 'super_admin'), allowNull: false },
      blocked_id:   { type: Sequelize.UUID, allowNull: false },
      blocked_type: { type: Sequelize.ENUM('user', 'admin', 'super_admin'), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // Blocking the same person twice is a no-op, not a second row.
    await queryInterface.addIndex(
      'chat_user_blocks',
      ['blocker_id', 'blocker_type', 'blocked_id', 'blocked_type'],
      { unique: true, name: 'uq_chat_user_blocks_pair' }
    );
    // The hot path: "who has this person blocked", run on every message
    // fetch to filter the list server-side.
    await queryInterface.addIndex('chat_user_blocks', ['blocker_id', 'blocker_type'], {
      name: 'idx_chat_user_blocks_blocker',
    });

    // -----------------------------------------------------------------
    // 2. chat_message_reports — the moderation queue
    // -----------------------------------------------------------------
    await queryInterface.createTable('chat_message_reports', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      // Nullable + SET NULL: a report outlives the message it is about.
      // The snapshot below is what moderation actually reads.
      message_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'chat_messages', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'chat_groups', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      reporter_id:   { type: Sequelize.UUID, allowNull: false },
      reporter_type: { type: Sequelize.ENUM('user', 'admin', 'super_admin'), allowNull: false },
      reported_user_id:   { type: Sequelize.UUID, allowNull: false },
      reported_user_type: { type: Sequelize.ENUM('user', 'admin', 'super_admin'), allowNull: false },

      // Optional free text from the reporter. The flow does not demand a
      // category: making someone classify abuse before they can escape it
      // is friction in the wrong place.
      reason: { type: Sequelize.TEXT, allowNull: true },

      // The evidence, frozen at report time. See note 1 above.
      message_snapshot: { type: Sequelize.TEXT, allowNull: false },
      reported_user_name_snapshot: { type: Sequelize.STRING(150), allowNull: true },
      reported_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },

      status: {
        type: Sequelize.ENUM('pending', 'reviewed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // What the moderator actually did. 'none' is a real outcome — a
      // reviewed report with no action is how a queue stays honest about
      // the difference between "handled" and "not looked at".
      action_taken: {
        type: Sequelize.ENUM('none', 'message_deleted', 'user_banned', 'both'),
        allowNull: true,
        defaultValue: null,
      },
      reviewed_by:   { type: Sequelize.UUID, allowNull: true },
      reviewed_by_type: { type: Sequelize.ENUM('admin', 'super_admin'), allowNull: true },
      reviewed_at:   { type: Sequelize.DATE, allowNull: true },
      review_note:   { type: Sequelize.TEXT, allowNull: true },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // One report per person per message. A second tap is idempotent
    // rather than a duplicate row cluttering the queue — and it stops one
    // person inflating the apparent weight of a report.
    await queryInterface.addIndex(
      'chat_message_reports',
      ['message_id', 'reporter_id', 'reporter_type'],
      { unique: true, name: 'uq_chat_message_reports_one_per_reporter' }
    );
    // The queue's own query: pending first, newest first.
    await queryInterface.addIndex('chat_message_reports', ['status', 'created_at'], {
      name: 'idx_chat_message_reports_queue',
    });
    await queryInterface.addIndex('chat_message_reports', ['group_id'], {
      name: 'idx_chat_message_reports_group',
    });
    // "How many times has this person been reported" — the question that
    // turns a pile of single reports into a pattern.
    await queryInterface.addIndex('chat_message_reports', ['reported_user_id'], {
      name: 'idx_chat_message_reports_reported',
    });

    // -----------------------------------------------------------------
    // 3. chat_group_members ban columns — see note 3 above
    // -----------------------------------------------------------------
    await queryInterface.addColumn('chat_group_members', 'is_banned', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('chat_group_members', 'banned_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    // admin.id or super_admin.id of whoever imposed it.
    await queryInterface.addColumn('chat_group_members', 'banned_by', {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.addColumn('chat_group_members', 'ban_reason', {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addIndex('chat_group_members', ['group_id', 'is_banned'], {
      name: 'idx_chat_group_members_banned',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('chat_group_members', 'idx_chat_group_members_banned');
    await queryInterface.removeColumn('chat_group_members', 'ban_reason');
    await queryInterface.removeColumn('chat_group_members', 'banned_by');
    await queryInterface.removeColumn('chat_group_members', 'banned_at');
    await queryInterface.removeColumn('chat_group_members', 'is_banned');

    await queryInterface.dropTable('chat_message_reports');
    await queryInterface.dropTable('chat_user_blocks');

    // MySQL keeps the ENUM types alive with the table in some Sequelize
    // versions; dropping the tables is enough here, but a Postgres port
    // would need explicit DROP TYPE calls.
  },
};
