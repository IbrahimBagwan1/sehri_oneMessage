'use strict';

/**
 * delivery_stops.delivered_by_rider_id: NO ACTION → SET NULL.
 *
 * The column records which team member tapped "delivered" — usually the
 * helper, on a stop that belongs to their captain. With NO ACTION, deleting
 * that helper (a super admin removing the rider, or the member deleting
 * their own account) failed on the foreign key, because the stop row
 * belongs to the captain and is not cascaded away with the helper. Account
 * deletion rolled back and answered 500.
 *
 * SET NULL keeps the stop (it is the record of a delivery that happened)
 * and forgets whose hand delivered it, which is also what erasure wants.
 * Idempotent: re-running finds the SET NULL constraint and does nothing.
 */

const { dropForeignKeysOn } = require('../utils/migrationHelpers');

const CONSTRAINT = 'fk_delivery_stops_delivered_by';

const currentRule = async (queryInterface) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT rc.DELETE_RULE AS rule
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
         ON rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND rc.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA
      WHERE k.TABLE_SCHEMA = DATABASE()
        AND k.TABLE_NAME = 'delivery_stops'
        AND k.COLUMN_NAME = 'delivered_by_rider_id'`
  );
  return rows[0]?.rule || null;
};

const addFk = (queryInterface, onDelete) => queryInterface.addConstraint('delivery_stops', {
  fields: ['delivered_by_rider_id'],
  type: 'foreign key',
  name: CONSTRAINT,
  references: { table: 'riders', field: 'id' },
  onDelete,
  onUpdate: 'CASCADE',
});

module.exports = {
  up: async (queryInterface) => {
    if ((await currentRule(queryInterface)) === 'SET NULL') return;
    await dropForeignKeysOn(queryInterface, 'delivery_stops', 'delivered_by_rider_id');
    await addFk(queryInterface, 'SET NULL');
  },

  down: async (queryInterface) => {
    if ((await currentRule(queryInterface)) === 'NO ACTION') return;
    await dropForeignKeysOn(queryInterface, 'delivery_stops', 'delivered_by_rider_id');
    await addFk(queryInterface, 'NO ACTION');
  },
};
