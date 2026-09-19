'use strict';

/**
 * sync-duas.js
 *
 * Standalone one-shot script that fills the dua_categories and duas
 * tables from the upstream Islamic API.
 *
 *   node scripts/sync-duas.js
 *
 * Re-running is safe — the sync service upserts on the stable slugs.
 */

require('dotenv').config();
const { syncDuas } = require('../src/services/islamicApiSync');
const { sequelize } = require('../src/config/database');
const logger = require('../src/utils/logger');

(async () => {
  try {
    await sequelize.authenticate();
    const result = await syncDuas({
      onProgress: ({ category, duas }) => {
        process.stdout.write(`  · ${category.padEnd(28, ' ')} → ${duas} duas\n`);
      },
    });
    logger.info(`Dua sync finished: ${result.categories} categories, ${result.duas} duas`);
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    logger.error(`Dua sync failed: ${err.stack || err.message}`);
    await sequelize.close().catch(() => {});
    process.exit(1);
  }
})();
