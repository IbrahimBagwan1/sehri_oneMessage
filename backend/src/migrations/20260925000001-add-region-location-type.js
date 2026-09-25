'use strict';

// -----------------------------------------------------------------------------
// Adds a 'region' level to the locations hierarchy, between city and area:
//
//   BEFORE  city → area → zone → address
//   AFTER   city → region → area → zone → address
//
// Two steps:
//   1. Widen the `type` ENUM to include 'region' (purely additive).
//   2. Insert one region row per city and re-parent every area that is
//      currently hanging directly off a city.
//
// Safety notes:
//   • Re-parenting only touches `area` rows whose parent is a city. Zones,
//     addresses, and every users.location_id are untouched — users point at
//     addresses/zones, which sit BELOW the inserted level.
//   • resolveZone / resolveZoneFromLoaded walk UPWARD looking for
//     type='zone', which is at most one hop above an address. Inserting a
//     level above `area` cannot affect them. buildLocationInclude eager-loads
//     5 parent hops; the deepest chain becomes address→zone→area→region→city
//     = 4 hops, still inside that budget.
//   • Idempotent-ish: if a region already exists for a city we reuse it
//     rather than creating a duplicate, so a re-run is harmless.
//
// The default region is named "<City> Central" because we cannot infer real
// North/South/East/West boundaries from existing data. A super admin can
// rename it and add sibling regions from the locations screen; the frontend
// picker walks whatever tree actually exists rather than hardcoding levels.
// -----------------------------------------------------------------------------

const { randomUUID } = require('crypto');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // ---- 1. Widen the ENUM ------------------------------------------------
    // MySQL needs the full column definition restated to alter an ENUM.
    await queryInterface.changeColumn('locations', 'type', {
      type: Sequelize.ENUM('city', 'region', 'area', 'zone', 'address'),
      allowNull: false,
    });

    // ---- 2. Insert regions + re-parent orphaned areas ---------------------
    const [cities] = await queryInterface.sequelize.query(
      "SELECT id, name FROM locations WHERE type = 'city'"
    );

    const now = new Date();

    for (const city of cities) {
      // Reuse an existing region under this city if one is already there.
      const [existing] = await queryInterface.sequelize.query(
        "SELECT id FROM locations WHERE type = 'region' AND parent_id = :cityId LIMIT 1",
        { replacements: { cityId: city.id } }
      );

      let regionId;
      if (existing.length > 0) {
        regionId = existing[0].id;
      } else {
        regionId = randomUUID();
        await queryInterface.bulkInsert('locations', [{
          id: regionId,
          name: `${city.name} Central`,
          type: 'region',
          parent_id: city.id,
          is_active: true,
          created_at: now,
          updated_at: now,
        }]);
      }

      // Move areas that currently sit directly under the city.
      await queryInterface.sequelize.query(
        "UPDATE locations SET parent_id = :regionId, updated_at = :now " +
        "WHERE type = 'area' AND parent_id = :cityId",
        { replacements: { regionId, cityId: city.id, now } }
      );
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Re-parent areas back onto their region's city, then drop the regions
    // and narrow the ENUM again. Order matters — we must clear the FK
    // references before deleting the region rows.
    const [regions] = await queryInterface.sequelize.query(
      "SELECT id, parent_id FROM locations WHERE type = 'region'"
    );

    const now = new Date();
    for (const region of regions) {
      await queryInterface.sequelize.query(
        "UPDATE locations SET parent_id = :cityId, updated_at = :now " +
        "WHERE type = 'area' AND parent_id = :regionId",
        { replacements: { cityId: region.parent_id, regionId: region.id, now } }
      );
    }

    await queryInterface.sequelize.query("DELETE FROM locations WHERE type = 'region'");

    await queryInterface.changeColumn('locations', 'type', {
      type: Sequelize.ENUM('city', 'area', 'zone', 'address'),
      allowNull: false,
    });
  },
};
