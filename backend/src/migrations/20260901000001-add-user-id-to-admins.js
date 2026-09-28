'use strict';

const { dropForeignKeysOn } = require('../utils/migrationHelpers');
/**
 * Adds a nullable user_id FK to the admins table.
 *
 * Nullable because:
 *  1. Existing admin rows have no corresponding users row yet.
 *  2. An admin doesn't have to be a registered user — they can exist
 *     purely as a zone coordinator without a resident account.
 *
 * When set, it means "this admin is also a regular user with this user_id"
 * and their token will carry user_id so they can vote, see poll history, etc.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('admins', 'user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      defaultValue: null,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      after: 'id',
    });

    await queryInterface.addIndex('admins', ['user_id'], {
      name: 'admins_user_id_idx',
    });
  },

  down: async (queryInterface) => {
    await dropForeignKeysOn(queryInterface, 'admins', 'user_id');
    await queryInterface.removeIndex('admins', 'admins_user_id_idx');
    await queryInterface.removeColumn('admins', 'user_id');
  },
};
