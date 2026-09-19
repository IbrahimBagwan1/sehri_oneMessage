'use strict';

/**
 * Adds text_indopak to quran_verses.
 *
 * The Indo-Pak (or "Nastaliq/Naskh Indopak") script is what most South
 * Asian mushafs use — different ortho­graphic conventions from the
 * Uthmani script we originally synced. Both variants ship in the
 * quran.com v4 API, so we store them side-by-side and let the reader
 * pick which to display.
 *
 * Legacy rows (populated before this migration) have text_indopak NULL;
 * the reader falls back to text_uthmani in that case. Re-running
 * `node scripts/sync-quran.js` after this migration backfills the
 * column across all 6236 verses.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('quran_verses', 'text_indopak', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('quran_verses', 'text_indopak');
  },
};
