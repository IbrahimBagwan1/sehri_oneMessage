'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('chat_messages', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'chat_groups',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // UUID of the sender. Points to users, admins, or super_admins
      // depending on sender_type. Not declared as a FK for same reason
      // as chat_group_members.user_id.
      sender_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      sender_type: {
        type: Sequelize.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      // Self-referential FK for reply threading.
      // Null = top-level message. Non-null = reply to another message.
      // ON DELETE SET NULL: if the parent message is hard-deleted from DB,
      // replies survive as orphaned top-level messages. (We use soft-delete
      // via is_deleted flag so this mainly acts as a safety net.)
      reply_to_id: {
        type: Sequelize.UUID,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'chat_messages',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      // Soft-delete flag. Set by the message owner or super_admin.
      // Row is kept so reply threads don't break; clients show
      // "This message was deleted" when is_deleted = true.
      is_deleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Primary query pattern: paginated messages for a group, newest first.
    await queryInterface.addIndex('chat_messages', ['group_id', 'created_at']);
    // Needed to fetch all messages sent by a particular user (delete check).
    await queryInterface.addIndex('chat_messages', ['sender_id']);
    // Reply thread lookups.
    await queryInterface.addIndex('chat_messages', ['reply_to_id']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('chat_messages');
  },
};
