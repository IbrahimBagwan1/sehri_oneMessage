require('dotenv').config({ quiet: true });

/**
 * sequelize-cli configuration (migrations and seeders). Mirrors
 * config/database.js — same variables, same TLS switch — so `npm run
 * migrate` always targets the database the server actually uses.
 */

const ssl = process.env.DB_SSL === 'true'
  ? { ssl: { require: true, rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } }
  : undefined;

const base = {
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  dialect: 'mysql',
  timezone: '+00:00',
  define: { underscored: true, timestamps: true },
  dialectOptions: ssl,
};

module.exports = {
  development: { ...base, database: process.env.DB_NAME },
  test: { ...base, database: process.env.TEST_DB_NAME || `${process.env.DB_NAME}_test` },
  production: { ...base, database: process.env.DB_NAME },
};
