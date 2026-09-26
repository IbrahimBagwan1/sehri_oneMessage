'use strict';

/**
 * Cache table for the Ayat of the Day.
 *
 * WHAT THIS IS NOT: this is not a curated pool of verses chosen by us, and it
 * is not related to `quran_chapters` / `quran_verses`, which hold the full
 * Qur'an corpus synced by services/islamicApiSync.js and served by
 * quranController. (There is no `topic_ayat` table in this codebase — a
 * themed Salah/Zakat/Sadaqah/Fasting pool does not exist here.) Every row
 * below is one day's verse as chosen by islamic.app, stored verbatim.
 *
 * WHY A TABLE AND NOT AN IN-MEMORY CACHE: the point is at most one upstream
 * call per UTC day across the whole community, and an in-process cache gives
 * one call per process per day — wrong the moment the API runs more than one
 * instance or restarts. The date is the primary key, so the uniqueness that
 * makes that guarantee real is enforced by the database rather than by our
 * own locking.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ayat_of_the_day', {
      // The UTC calendar date this verse belongs to, YYYY-MM-DD.
      // PRIMARY KEY, which is what makes the cache race-safe: two concurrent
      // misses both try to insert, one wins, the loser re-reads the winner's
      // row instead of making a second upstream call.
      date: {
        type: Sequelize.STRING(10),
        allowNull: false,
        primaryKey: true,
      },
      // The upstream response's `data` object, stored verbatim. JSON so a
      // change in islamic.app's shape never needs a migration; the controller
      // normalises what the client sees.
      payload: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      fetched_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
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

    // Serving a stale row on an upstream failure means "the newest one we
    // have", which is an ORDER BY on this column.
    await queryInterface.addIndex('ayat_of_the_day', ['fetched_at'], {
      name: 'ayat_of_the_day_fetched_at',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('ayat_of_the_day');
  },
};
