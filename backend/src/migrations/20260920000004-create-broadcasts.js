'use strict';

/**
 * Creates the broadcasts table.
 *
 * A broadcast is a one-shot push notification the super-admin sends to
 * every approved user (or every user in a specific zone). The row is an
 * audit trail: what was sent, by whom, when, and how many devices Expo
 * accepted the push for.
 *
 * target_location_id is nullable — NULL means "all approved users",
 * otherwise it names a zone (or any parent in the location chain) and
 * the controller resolves the descendant set at send time.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('broadcasts', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      // NULL = broadcast to every approved user, otherwise the zone id.
      target_location_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'locations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      // super_admin.id — the sender. Kept lightweight (no FK) so a
      // deleted super_admin row doesn't cascade over broadcast history.
      sent_by: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      // How many users matched the target audience at send time.
      recipient_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // How many Expo push tickets were accepted (may be < recipient_count
      // when some users have no push token or an invalid one).
      delivered_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.addIndex('broadcasts', ['sent_by']);
    await queryInterface.addIndex('broadcasts', ['target_location_id']);
    await queryInterface.addIndex('broadcasts', ['created_at']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('broadcasts');
  },
};
