'use strict';

/**
 * Creates the profile_edit_requests table.
 *
 * A user submits a request to change one or more editable profile fields.
 * The requested_changes column is a JSON blob whose keys correspond to
 * columns on the users table (allow-listed in userController.js).
 *
 * status transitions strictly forward: pending → approved | rejected.
 * Only one row per user may be in 'pending' at any given time — this is
 * enforced in the controller (Sequelize partial unique indexes aren't
 * supported on MySQL).
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('profile_edit_requests', {
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
        onDelete: 'CASCADE',
      },
      requested_changes: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      reviewed_by: {
        // super_admin.id — kept as a plain UUID (super_admins is a
        // separate table; cross-table FK on UUIDs adds migration noise for
        // little runtime benefit).
        type: Sequelize.UUID,
        allowNull: true,
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      admin_note: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('profile_edit_requests', ['user_id']);
    await queryInterface.addIndex('profile_edit_requests', ['status']);
    await queryInterface.addIndex('profile_edit_requests', ['user_id', 'status']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('profile_edit_requests');
  },
};
