'use strict';

/**
 * sync-duas.js
 *
 * Loads the bundled dua library (backend/src/data/duas-seed.json) into
 * the dua_categories and duas tables. Idempotent — re-running refreshes
 * the rows in place.
 *
 *   node scripts/sync-duas.js
 *
 * To extend the library, edit the seed file and run this again.
 */

require('dotenv').config();
const { syncDuasFromSeed } = require('../src/services/islamicApiSync');
const { sequelize } = require('../src/config/database');
const logger = require('../src/utils/logger');

(async () => {
  try {
    await sequelize.authenticate();
    const result = await syncDuasFromSeed({
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
