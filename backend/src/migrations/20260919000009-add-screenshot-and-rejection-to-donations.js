'use strict';

/**
 * Adds screenshot_url + rejection_reason to the donations table.
 *
 * Screenshot storage: Cloudinary. The URL is what's persisted.
 * Legacy rows (from before this migration) have screenshot_url = NULL —
 * that's fine, the column is nullable at the DB layer for backwards
 * compatibility, but the controller enforces its presence on new
 * submissions.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('donations', 'screenshot_url', {
      type: Sequelize.TEXT,
      allowNull: true, // nullable for legacy rows; required by the API layer
    });
    await queryInterface.addColumn('donations', 'rejection_reason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('donations', 'rejection_reason');
    await queryInterface.removeColumn('donations', 'screenshot_url');
  },
};
