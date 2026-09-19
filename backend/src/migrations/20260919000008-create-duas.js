'use strict';

/**
 * Creates the duas table.
 *
 * The `slug` column is the stable identifier from upstream and is unique
 * globally (not just per-category) so that /v1/dhikr/entry/{slug} maps
 * 1:1 to a row. order_index preserves the intended reading order within
 * the category.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('duas', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      category_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'dua_categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      slug: {
        // Stable upstream identifier — globally unique.
        type: Sequelize.STRING(150),
        allowNull: false,
        unique: true,
      },
      name: {
        // Short title, e.g. "Dua on entering the bathroom"
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      arabic_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      transliteration: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      translation: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      source: {
        // Reference, e.g. "Bukhari 6320", "Abu Dawud 5057"
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      order_index: {
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

    await queryInterface.addIndex('duas', ['category_id']);
    await queryInterface.addIndex('duas', ['slug'], { unique: true });
    await queryInterface.addIndex('duas', ['category_id', 'order_index']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('duas');
  },
};
