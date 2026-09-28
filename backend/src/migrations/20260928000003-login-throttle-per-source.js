'use strict';

/**
 * Re-key login_throttles so a lockout cannot be used against the victim.
 *
 * The first version counted failures per PHONE only: anyone who knew a
 * member's number could type five wrong passwords and lock the real owner
 * out, escalating to an hour, for as long as they cared to repeat it. Rows
 * are now keyed by a free-form throttle_key:
 *
 *   pi:<phone>:<source>  — one phone from one network. Five failures lock
 *                          THAT pair: the attacker's network, not the owner's.
 *   p:<phone>            — one phone from anywhere. Only a distributed attack
 *                          reaches this threshold, and then password sign-in
 *                          for the number needs an OTP reset first — which
 *                          only the phone's owner can do.
 *
 * The table holds only short-lived counters, so it is recreated rather than
 * migrated. Idempotent: safe to re-run after a partial failure.
 */

const { columnExists, tableExists } = require('../utils/migrationHelpers');

const newShape = (Sequelize) => ({
  throttle_key: { type: Sequelize.STRING(120), primaryKey: true, allowNull: false },
  failures: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  window_started_at: { type: Sequelize.DATE, allowNull: true },
  lockouts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  locked_until: { type: Sequelize.DATE, allowNull: true },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
});

const oldShape = (Sequelize) => ({
  phone: { type: Sequelize.STRING(15), primaryKey: true, allowNull: false },
  failures: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  window_started_at: { type: Sequelize.DATE, allowNull: true },
  lockouts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  locked_until: { type: Sequelize.DATE, allowNull: true },
  created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
  updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
});

module.exports = {
  up: async (queryInterface, Sequelize) => {
    if (await tableExists(queryInterface, 'login_throttles')) {
      if (await columnExists(queryInterface, 'login_throttles', 'throttle_key')) return;
      await queryInterface.dropTable('login_throttles');
    }
    await queryInterface.createTable('login_throttles', newShape(Sequelize));
  },

  down: async (queryInterface, Sequelize) => {
    if (await tableExists(queryInterface, 'login_throttles')) {
      if (await columnExists(queryInterface, 'login_throttles', 'phone')) return;
      await queryInterface.dropTable('login_throttles');
    }
    await queryInterface.createTable('login_throttles', oldShape(Sequelize));
  },
};
