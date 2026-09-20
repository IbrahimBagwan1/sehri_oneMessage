'use strict';

/**
 * Adds latitude + longitude + geocoded_at to the locations table.
 *
 * Populated by a super-admin coordinate-picker screen (one-time-per-PG),
 * not by an auto-geocoder — the community's PGs are a small closed set
 * and manual pins are more accurate than API geocoding for named
 * hostels + PGs. Nullable so unassigned rows continue to validate;
 * downstream code (ETA calculator) skips any destination without coords.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('locations', 'latitude', {
      type: Sequelize.DECIMAL(10, 7),
      allowNull: true,
    });
    await queryInterface.addColumn('locations', 'longitude', {
      type: Sequelize.DECIMAL(10, 7),
      allowNull: true,
    });
    await queryInterface.addColumn('locations', 'geocoded_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('locations', 'geocoded_at');
    await queryInterface.removeColumn('locations', 'longitude');
    await queryInterface.removeColumn('locations', 'latitude');
  },
};
