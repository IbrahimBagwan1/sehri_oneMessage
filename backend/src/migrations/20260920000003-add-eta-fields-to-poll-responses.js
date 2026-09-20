'use strict';

/**
 * Adds live-ETA + proximity-notification state to poll_responses.
 *
 * A poll_response is the natural "one row per delivery" record — the
 * user voted yes (or was approved as a special case) and food will be
 * delivered to their address. During the delivery window we compute an
 * ETA for each such row and push a "rider arriving in X min"
 * notification exactly once (proximity_notified_at guards against
 * spamming while the ETA hovers near the threshold).
 *
 * All three columns are nullable so historical rows validate.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('poll_responses', 'current_eta_minutes', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('poll_responses', 'current_eta_updated_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('poll_responses', 'proximity_notified_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('poll_responses', 'proximity_notified_at');
    await queryInterface.removeColumn('poll_responses', 'current_eta_updated_at');
    await queryInterface.removeColumn('poll_responses', 'current_eta_minutes');
  },
};
