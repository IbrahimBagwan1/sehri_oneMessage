'use strict';

/**
 * Adds promotion audit fields to admins + super_admins.
 *
 * When a super admin promotes an existing user via
 * POST /api/admin/users/:id/promote, we record who did it and when.
 * Both columns are nullable because existing rows (and any admin/super
 * admin created through the "standalone" mode, without promoting a
 * user) have no promotion event to record.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('admins', 'promoted_by', {
      // super_admin.id of the super admin who ran the promotion.
      // Kept as a plain UUID (no FK) because super_admins is a separate
      // table and cross-table FK on UUID adds migration noise.
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.addColumn('admins', 'promoted_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex('admins', ['promoted_by']);

    await queryInterface.addColumn('super_admins', 'promoted_by', {
      type: Sequelize.UUID,
      allowNull: true,
    });
    await queryInterface.addColumn('super_admins', 'promoted_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addIndex('super_admins', ['promoted_by']);
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('super_admins', ['promoted_by']);
    await queryInterface.removeColumn('super_admins', 'promoted_at');
    await queryInterface.removeColumn('super_admins', 'promoted_by');
    await queryInterface.removeIndex('admins', ['promoted_by']);
    await queryInterface.removeColumn('admins', 'promoted_at');
    await queryInterface.removeColumn('admins', 'promoted_by');
  },
};
