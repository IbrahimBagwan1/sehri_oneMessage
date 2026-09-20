'use strict';
// Use Node's built-in randomUUID — the `uuid` npm package is ESM-only
// in v14 and can't be `require`d from a sequelize-cli seeder (CJS).
const { randomUUID: uuidv4 } = require('crypto');

module.exports = {
  up: async (queryInterface) => {
    const cityId = uuidv4();

    const areaNames = ['Kengeri', 'Nayandahalli', 'Nagarabhavi', 'Uttarahalli'];
    const areaIds = areaNames.map(() => uuidv4());

    const zoneNames = ['Masjid', 'Boys Hostel', 'Stanza Living', 'Girls Accommodation'];
    // Each zone is placed under the first area for now — Super Admin can
    // reassign real zone->area mappings later via the admin panel once
    // ground-truth addresses are confirmed. This just seeds a valid, working chain.
    const zoneParentAreaId = areaIds[0];

    const now = new Date();

    const cityRow = {
      id: cityId,
      name: 'Bangalore',
      type: 'city',
      parent_id: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    };

    const areaRows = areaNames.map((name, i) => ({
      id: areaIds[i],
      name,
      type: 'area',
      parent_id: cityId,
      is_active: true,
      created_at: now,
      updated_at: now,
    }));

    const zoneRows = zoneNames.map((name) => ({
      id: uuidv4(),
      name,
      type: 'zone',
      parent_id: zoneParentAreaId,
      is_active: true,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert('locations', [cityRow, ...areaRows, ...zoneRows]);
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('locations', null, {});
  },
};
