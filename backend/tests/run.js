'use strict';

/**
 * tests/run.js — `npm test`.
 *
 * DEFAULT MODE (recommended, and what CI should run)
 *   1. Drops and recreates `${DB_NAME}_test`, so every run starts from an
 *      EMPTY database — "the migrations apply cleanly, in order, from
 *      nothing" is proven on every run, not assumed.
 *   2. Runs every migration.
 *   3. With --rollback: undoes every migration and re-applies them all, to
 *      prove each `down` works and leaves a schema the `up`s accept.
 *   4. Runs tests/**\/*.test.js with Node's built-in runner, one file at a
 *      time (they share the database). No test framework dependency.
 *
 *   The MySQL user needs rights on the _test database:
 *     GRANT ALL PRIVILEGES ON `<DB_NAME>_test`.* TO '<DB_USER>'@'localhost';
 *
 * --existing-db MODE (for a machine where that grant is not possible)
 *   Runs the suites against TEST_DB_NAME (which you must set explicitly),
 *   without dropping or migrating it. Every suite builds its own uniquely
 *   named fixtures and deletes exactly those rows afterwards, so an existing
 *   development database is left as it was — but prefer the default mode.
 *
 * Unit suites (tests/unit) need no database at all:
 *   node --test "tests/unit/*.test.js"
 */

require('dotenv').config({ quiet: true });
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const env = { ...process.env, NODE_ENV: 'test' };
const args = process.argv.slice(2);
const existingDb = args.includes('--existing-db');

const run = (cmd, cmdArgs, label) => {
  // npx is a .cmd shim on Windows and needs a shell; node itself must NOT
  // go through one, because its path ("C:\Program Files\...") has a space.
  const shell = process.platform === 'win32' && cmd === 'npx';
  const res = spawnSync(cmd, cmdArgs, { cwd: ROOT, env, stdio: 'inherit', shell });
  if (res.status !== 0) {
    console.error(`\n✗ ${label} failed (exit ${res.status})`);
    process.exit(res.status || 1);
  }
};

(async () => {
  if (existingDb) {
    if (!process.env.TEST_DB_NAME) {
      console.error('--existing-db needs TEST_DB_NAME set to the database to run against.');
      process.exit(1);
    }
    console.log(`• running against existing database ${process.env.TEST_DB_NAME} (no drop, no migrate)`);
  } else {
    const mysql = require('mysql2/promise');
    const dbName = process.env.TEST_DB_NAME || `${process.env.DB_NAME}_test`;
    if (!/_test$/.test(dbName)) {
      console.error(`Refusing to DROP "${dbName}": the default mode only recreates databases ending in _test.`);
      process.exit(1);
    }
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
    });
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } catch (err) {
      console.error(`\nCould not recreate ${dbName}: ${err.message}`);
      console.error('Grant the test database to the app user (as a MySQL admin), then re-run:');
      console.error(`  GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${process.env.DB_USER}'@'localhost';`);
      process.exit(1);
    } finally {
      await conn.end();
    }
    console.log(`• fresh database ${dbName}`);

    run('npx', ['sequelize-cli', 'db:migrate', '--env', 'test'], 'migrations (empty → latest)');

    if (args.includes('--rollback')) {
      run('npx', ['sequelize-cli', 'db:migrate:undo:all', '--env', 'test'], 'rollback of every migration');
      run('npx', ['sequelize-cli', 'db:migrate', '--env', 'test'], 're-applying migrations after rollback');
      console.log('• every migration rolled back and re-applied cleanly');
    }
  }

  const only = args.filter((a) => !a.startsWith('--'));
  const files = only.length ? only : ['tests/**/*.test.js'];
  run(process.execPath, ['--test', '--test-concurrency=1', ...files], 'test suites');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
