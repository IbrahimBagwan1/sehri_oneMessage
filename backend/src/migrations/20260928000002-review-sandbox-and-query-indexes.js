'use strict';

/**
 * Two unrelated changes that both came out of the release audit.
 *
 * 1. locations.is_sandbox
 *    App Review and Play review cannot receive an SMS OTP on an Indian
 *    number, and a new account waits for approval, so reviewers need a
 *    ready-made account. That account must see nothing real: it lives in a
 *    sandbox zone that is hidden from the public location picker, left out
 *    of kitchen counts and delivery runs, and has its own chat room. See
 *    services/reviewDemoService.js. The flag is what every one of those
 *    exclusions keys on.
 *
 * 2. Indexes for the queries the app actually runs.
 *    • users.fcm_token was TEXT, which MySQL cannot index without a prefix.
 *      Clearing a dead Expo token — and, now, detaching a token from the
 *      previous account on a shared phone — scanned the whole users table.
 *      Expo tokens are ~45 characters; VARCHAR(255) indexes normally.
 *    • donations (status, created_at) and feedback (is_read, created_at)
 *      match the admin lists: filter by one, newest first.
 *    • delivery_stops (poll_id, status) matches "pending stops tonight",
 *      which is now read on every rider GPS push via pollCalendar.
 *    • otps (phone, created_at) matches the new per-number daily send cap.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('locations', 'is_sandbox', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.changeColumn('users', 'fcm_token', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addIndex('users', ['fcm_token'], { name: 'idx_users_fcm_token' });

    await queryInterface.addIndex('donations', ['status', 'created_at'], {
      name: 'idx_donations_status_created',
    });
    await queryInterface.addIndex('feedback', ['is_read', 'created_at'], {
      name: 'idx_feedback_read_created',
    });
    await queryInterface.addIndex('delivery_stops', ['poll_id', 'status'], {
      name: 'idx_delivery_stops_poll_status',
    });
    await queryInterface.addIndex('otps', ['phone', 'created_at'], {
      name: 'idx_otps_phone_created',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('otps', 'idx_otps_phone_created');
    await queryInterface.removeIndex('delivery_stops', 'idx_delivery_stops_poll_status');
    await queryInterface.removeIndex('feedback', 'idx_feedback_read_created');
    await queryInterface.removeIndex('donations', 'idx_donations_status_created');
    await queryInterface.removeIndex('users', 'idx_users_fcm_token');
    await queryInterface.changeColumn('users', 'fcm_token', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.removeColumn('locations', 'is_sandbox');
  },
};
