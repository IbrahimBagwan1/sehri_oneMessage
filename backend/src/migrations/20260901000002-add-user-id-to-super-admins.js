'use strict';

const { dropForeignKeysOn } = require('../utils/migrationHelpers');
/**
 * Adds a nullable user_id FK to the super_admins table.
 * Same rationale as the admins migration — nullable to preserve existing rows.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('super_admins', 'user_id', {
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

    await queryInterface.addIndex('super_admins', ['user_id'], {
      name: 'super_admins_user_id_idx',
    });
  },

  down: async (queryInterface) => {
    await dropForeignKeysOn(queryInterface, 'super_admins', 'user_id');
    await queryInterface.removeIndex('super_admins', 'super_admins_user_id_idx');
    await queryInterface.removeColumn('super_admins', 'user_id');
  },
};
