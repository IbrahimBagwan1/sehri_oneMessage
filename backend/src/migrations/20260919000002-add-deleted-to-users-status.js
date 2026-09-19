'use strict';

/**
 * Adds 'deleted' to the users.status ENUM.
 *
 * Soft-deleted rows are marked status='deleted' and have their PII
 * anonymized (name/phone/address/fcm_token). Referential integrity to
 * poll_responses, donations, chat_messages etc. is preserved.
 *
 * MySQL requires the full ENUM re-declaration to add a value.
 */
module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      "ALTER TABLE users MODIFY COLUMN status ENUM('pending','approved','rejected','deleted') NOT NULL DEFAULT 'pending';"
    );
  },

  down: async (queryInterface) => {
    // Reverting drops the 'deleted' value; any existing deleted rows must
    // be handled first (this migration is only meant to be rolled back
    // in dev environments).
    await queryInterface.sequelize.query(
      "ALTER TABLE users MODIFY COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending';"
    );
  },
};
