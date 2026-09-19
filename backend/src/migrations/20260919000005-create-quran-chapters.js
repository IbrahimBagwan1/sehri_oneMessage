'use strict';

/**
 * Creates the quran_chapters table (surahs).
 *
 * Uses INTEGER primary keys (1..114) instead of UUID: surah numbers are
 * a canonical, well-known part of the Quran itself — enshrining them in
 * the PK makes URLs (`/api/quran/1`) and verse_keys ("2:255") natural.
 * This is the one place in the codebase where we deliberately deviate
 * from the UUID-PK convention.
 *
 * Content is populated by the sync service from api.islamic.app; nothing
 * on this table is user-generated.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('quran_chapters', {
      id: {
        // The surah number, 1..114. Not auto-increment — the sync script
        // provides the canonical id when upserting.
        type: Sequelize.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      name_arabic: {
        // e.g. "الفاتحة"
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      name_simple: {
        // Transliterated English name, e.g. "Al-Fatihah"
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      translated_name: {
        // English meaning, e.g. "The Opener"
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      revelation_place: {
        type: Sequelize.ENUM('meccan', 'medinan'),
        allowNull: false,
      },
      verses_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      bismillah_pre: {
        // False for surah 9 (At-Tawbah); UI uses this to decide whether
        // to render the bismillah header at the top of the reader.
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('quran_chapters', ['revelation_place']);
    await queryInterface.addIndex('quran_chapters', ['name_simple']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quran_chapters');
  },
};
