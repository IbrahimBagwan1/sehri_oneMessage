'use strict';

/**
 * guard-seed.js — runs before `npm run seed`.
 *
 * The seeders create a demo location tree (Bangalore → Kengeri → Masjid …).
 * On a production database that would add fake zones next to real ones —
 * into the registration picker, the kitchen counts and the chat list. So
 * seeding refuses to run when NODE_ENV=production unless someone says, in
 * so many words, that they mean it.
 */

require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'yes-i-am-sure') {
  console.error(
    'Refusing to seed: NODE_ENV=production.\n'
    + 'The seeders insert demo locations. If this really is a fresh production database\n'
    + 'that should start with them, re-run with ALLOW_PRODUCTION_SEED=yes-i-am-sure.'
  );
  process.exit(1);
}
