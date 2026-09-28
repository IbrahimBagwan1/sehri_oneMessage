const { Sequelize } = require('sequelize');
require('dotenv').config({ quiet: true });
const logger = require('../utils/logger');

/**
 * The runtime connection pool. config/config.js is the sequelize-cli twin
 * used for migrations; the two read the same variables so they always talk
 * to the same database.
 *
 *   NODE_ENV=test      → `${DB_NAME}_test`, so the test suite can never touch
 *                        development or production data
 *   DB_POOL_MAX        → connections per process (default 10). MySQL's
 *                        default max_connections is 151; leave headroom for
 *                        every instance plus migrations and a console.
 *   DB_SSL=true        → TLS to the database, required by most managed
 *                        MySQL providers. DB_SSL_REJECT_UNAUTHORIZED=false
 *                        only for providers with a self-signed chain.
 */

// TEST_DB_NAME exists for machines where the MySQL user may only use one
// database; tests/run.js --existing-db documents when that is acceptable.
const databaseName = process.env.NODE_ENV === 'test'
  ? (process.env.TEST_DB_NAME || `${process.env.DB_NAME}_test`)
  : process.env.DB_NAME;

const sslOptions = () => {
  if (process.env.DB_SSL !== 'true') return undefined;
  return {
    ssl: {
      require: true,
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    },
  };
};

const sequelize = new Sequelize(
  databaseName,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    // Store and return DATETIMEs as UTC regardless of the host's zone; every
    // IST conversion happens explicitly in utils/istTime.js.
    timezone: '+00:00',
    logging: process.env.DB_LOG_SQL === 'true' ? (msg) => logger.debug(msg) : false,
    dialectOptions: sslOptions(),
    define: {
      underscored: true,   // snake_case columns in DB, matches doc's schema style
      timestamps: true,
    },
    pool: {
      max: Number.parseInt(process.env.DB_POOL_MAX || '10', 10),
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  }
);

const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established successfully.');
  } catch (err) {
    logger.error(`Unable to connect to the database: ${err.message}`);
    throw err;
  }
};

module.exports = { sequelize, testConnection, databaseName };
