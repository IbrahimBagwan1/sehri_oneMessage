'use strict';

// The Stanza zone id is not deterministic — the locations seeder
// generates a fresh UUID for every zone. Look it up by name here so
// this seeder works no matter which machine created the zones.
const { randomUUID } = require('crypto');

const ADDRESS_NAMES = [
  '888 7th Stage 11th Cross Road Mylasandra Kings and Queens PG',
  'Stanza Living (Cordoba)',
  'Target PG',
  'RR Luxury PG',
  'Krishna Villa Apartments',
  'Balaji PG for Gents',
  'Lasya PG',
  'Shiva Sai PG',
  'Stanza Living (Huelva House)',
  'Global Vista',
  'SS Luxury PG',
  'Good Lands PG',
  'Millenial Blue Opal',
  'Paras Global Kutir',
  'Others',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    // Locate the Stanza zone by name so we get whatever UUID the
    // previous seeder assigned it on this machine.
    const [rowsFound] = await queryInterface.sequelize.query(
      "SELECT id FROM locations WHERE type = 'zone' AND name = 'Stanza Living' LIMIT 1"
    );
    if (!rowsFound.length) {
      throw new Error(
        "Cannot seed Stanza addresses: no zone named 'Stanza Living' exists. " +
        "Run the locations seeder first."
      );
    }
    const stanzaZoneId = rowsFound[0].id;

    const rows = ADDRESS_NAMES.map((name) => ({
      id: randomUUID(),
      name,
      type: 'address',
      parent_id: stanzaZoneId,
      is_active: true,
      // created_at / updated_at are DEFAULT_GENERATED CURRENT_TIMESTAMP in the DB,
      // so we deliberately omit them here rather than guessing camelCase vs snake_case.
    }));

    await queryInterface.bulkInsert('locations', rows, {});
  },

  async down(queryInterface, Sequelize) {
    const [rowsFound] = await queryInterface.sequelize.query(
      "SELECT id FROM locations WHERE type = 'zone' AND name = 'Stanza Living' LIMIT 1"
    );
    if (!rowsFound.length) return;
    await queryInterface.bulkDelete('locations', {
      type: 'address',
      parent_id: rowsFound[0].id,
    }, {});
  },
};