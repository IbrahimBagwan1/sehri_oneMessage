'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('chat_group_members', {
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
      // UUID of the member. Points to users, admins, or super_admins
      // depending on user_type. Not declared as a FK here because it
      // can reference three different tables — enforced in the controller.
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      user_type: {
        type: Sequelize.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
      },
      // Timestamp of the last message this member has seen.
      // Used to compute the unread badge count: count messages with
      // created_at > last_read_at for this group.
      last_read_at: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
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

    // One membership row per user per group — DB-level guarantee.
    await queryInterface.addIndex('chat_group_members', ['group_id', 'user_id'], { unique: true });
    await queryInterface.addIndex('chat_group_members', ['group_id']);
    // Used by GET /groups to find all groups a given user belongs to.
    await queryInterface.addIndex('chat_group_members', ['user_id']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('chat_group_members');
  },
};
