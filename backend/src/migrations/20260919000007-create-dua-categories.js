'use strict';

/**
 * Creates the dua_categories table.
 *
 * Categories map 1:1 to api.islamic.app's /v1/dhikr taxonomy. The `slug`
 * is the stable identifier used both in our public URL (/api/dua/:slug)
 * and by the sync service as the upstream primary key.
 *
 * dua_count is denormalized so the categories list can render counts
 * without a join+count-per-row. The sync script keeps it in sync.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('dua_categories', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      slug: {
        // Stable identifier from upstream, e.g. "morning", "after-prayer".
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true,
      },
      name: {
        // Display name, e.g. "Morning Adhkar"
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      dua_count: {
        // Denormalized count. Kept fresh by the sync script.
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      order_index: {
        // Display order in the category list. Uses upstream index or
        // insertion order if none provided.
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('dua_categories', ['slug'], { unique: true });
    await queryInterface.addIndex('dua_categories', ['order_index']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('dua_categories');
  },
};
