'use strict';

/**
 * Helpers for migration `down` functions. Kept outside src/migrations/
 * because sequelize-cli treats every file in that folder as a migration.
 */

/**
 * Drop every foreign key on `table.column`.
 *
 * MySQL refuses to drop an index that a foreign key depends on ("needed in
 * a foreign key constraint"), and addColumn/createTable generate FK names
 * we never chose — so a rollback that removes an FK column's index must
 * first look the constraint up and remove it. Found by rolling every
 * migration back on a real MySQL 8 database (tests/run.js --rollback).
 */
const dropForeignKeysOn = async (queryInterface, table, column) => {
  const [fks] = await queryInterface.sequelize.query(
    `SELECT CONSTRAINT_NAME AS name
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :table
        AND COLUMN_NAME = :column
        AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { replacements: { table, column } }
  );
  for (const fk of fks) {
    await queryInterface.removeConstraint(table, fk.name);
  }
  return fks.length;
};

/*
 * Idempotent building blocks.
 *
 * MySQL DDL is not transactional: if a migration fails half way, the steps
 * before the failure stay applied and SequelizeMeta does not record the
 * migration, so re-running it fails on the first step ("Duplicate column").
 * On a production deploy that means hand-written SQL at the worst moment.
 * Migrations built from these helpers can simply be run again.
 */
const columnExists = async (queryInterface, table, column) => {
  const desc = await queryInterface.describeTable(table);
  return Object.prototype.hasOwnProperty.call(desc, column);
};

const indexExists = async (queryInterface, table, name) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME = :name LIMIT 1`,
    { replacements: { table, name } }
  );
  return rows.length > 0;
};

const tableExists = async (queryInterface, table) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1`,
    { replacements: { table } }
  );
  return rows.length > 0;
};

const addColumnIfMissing = async (queryInterface, table, column, spec) => {
  if (!(await columnExists(queryInterface, table, column))) {
    await queryInterface.addColumn(table, column, spec);
  }
};

const removeColumnIfExists = async (queryInterface, table, column) => {
  if (await columnExists(queryInterface, table, column)) {
    await queryInterface.removeColumn(table, column);
  }
};

const addIndexIfMissing = async (queryInterface, table, fields, options) => {
  if (!(await indexExists(queryInterface, table, options.name))) {
    await queryInterface.addIndex(table, fields, options);
  }
};

const removeIndexIfExists = async (queryInterface, table, name) => {
  if (await indexExists(queryInterface, table, name)) {
    await queryInterface.removeIndex(table, name);
  }
};

const createTableIfMissing = async (queryInterface, table, spec) => {
  if (!(await tableExists(queryInterface, table))) {
    await queryInterface.createTable(table, spec);
  }
};

module.exports = {
  dropForeignKeysOn,
  columnExists,
  indexExists,
  tableExists,
  addColumnIfMissing,
  removeColumnIfExists,
  addIndexIfMissing,
  removeIndexIfExists,
  createTableIfMissing,
};
