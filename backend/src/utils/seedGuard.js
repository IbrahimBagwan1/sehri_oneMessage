'use strict';

/**
 * Refuse to run a seeder against production.
 *
 * Seeders insert demo locations (Bangalore → Kengeri → Masjid …). On a
 * production database they would appear in the registration picker, the
 * kitchen counts and the chat list. `npm run seed` checks this too
 * (scripts/guard-seed.js), but `npx sequelize-cli db:seed:all` bypasses npm
 * scripts, so every seeder also calls this itself.
 */
const assertNotProduction = () => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'yes-i-am-sure') {
    throw new Error(
      'Refusing to seed: NODE_ENV=production. The seeders insert demo locations. '
      + 'Set ALLOW_PRODUCTION_SEED=yes-i-am-sure only for a brand-new database that should start with them.'
    );
  }
};

module.exports = { assertNotProduction };
