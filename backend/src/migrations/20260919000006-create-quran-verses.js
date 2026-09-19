'use strict';

/**
 * Creates the quran_verses table.
 *
 * Content is populated by the sync service and treated as read-only from
 * the app. The (chapter_id, verse_number) unique index enforces "one row
 * per verse position" — the sync script relies on this for upsert
 * idempotency.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('quran_verses', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      chapter_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'quran_chapters', key: 'id' },
        onUpdate: 'CASCADE',
        // No cascade delete — chapters should never actually be deleted;
        // if we ever do drop one we want the failure to be loud.
        onDelete: 'RESTRICT',
      },
      verse_number: {
        // Ayah number within the surah, 1..verses_count.
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      verse_key: {
        // Canonical "surah:ayah" e.g. "2:255". Denormalized so clients
        // can share a single string and we can index-lookup on it too.
        type: Sequelize.STRING(15),
        allowNull: false,
      },
      text_uthmani: {
        // Primary Arabic script (Uthmani orthography).
        type: Sequelize.TEXT,
        allowNull: false,
      },
      translation_text: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      translation_source: {
        // e.g. "Sahih International". Nullable if a translation ever
        // fails to sync — the reader falls back to Arabic-only.
        type: Sequelize.STRING(150),
        allowNull: true,
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

    await queryInterface.addIndex('quran_verses', ['chapter_id']);
    await queryInterface.addIndex('quran_verses', ['verse_key']);
    // The upsert path uses this — must be unique.
    await queryInterface.addIndex('quran_verses', ['chapter_id', 'verse_number'], {
      unique: true,
      name: 'quran_verses_chapter_verse_unique',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('quran_verses');
  },
};
