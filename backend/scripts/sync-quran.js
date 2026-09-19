'use strict';

/**
 * sync-quran.js
 *
 * Standalone one-shot script that fills the quran_chapters and
 * quran_verses tables from the upstream Islamic API. Run this once at
 * deploy time (or after migrations) so the app has content to serve.
 *
 *   node scripts/sync-quran.js
 *
 * Re-running is safe — the sync service upserts on natural keys.
 */

require('dotenv').config();
const { syncQuran } = require('../src/services/islamicApiSync');
const { sequelize } = require('../src/config/database');
const logger = require('../src/utils/logger');

(async () => {
  try {
    await sequelize.authenticate();
    const result = await syncQuran({
      onProgress: ({ chapter, verses }) => {
        process.stdout.write(`  · surah ${chapter.toString().padStart(3, ' ')}: ${verses} verses\n`);
      },
    });
    logger.info(`Quran sync finished: ${result.chapters} chapters, ${result.verses} verses`);
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    logger.error(`Quran sync failed: ${err.stack || err.message}`);
    await sequelize.close().catch(() => {});
    process.exit(1);
  }
})();
