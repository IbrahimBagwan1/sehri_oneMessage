'use strict';

/**
 * Creates the feedback table.
 *
 * A user submits feedback tagged with a category. Admins in the user's
 * zone (or any super_admin) see it and can mark it read.
 *
 * read_by / read_at persist so we can distinguish "no one has looked" from
 * "an admin marked this handled".
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('feedback', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      category: {
        type: Sequelize.ENUM('suggestion', 'complaint', 'bug', 'appreciation', 'other'),
        allowNull: false,
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      is_read: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // admin.id or super_admin.id of the reviewer — nullable until read.
      read_by: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      read_at: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await queryInterface.addIndex('feedback', ['user_id']);
    await queryInterface.addIndex('feedback', ['category']);
    await queryInterface.addIndex('feedback', ['is_read']);
    await queryInterface.addIndex('feedback', ['created_at']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('feedback');
  },
};
