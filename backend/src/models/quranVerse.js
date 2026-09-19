'use strict';

module.exports = (sequelize, DataTypes) => {
  const QuranVerse = sequelize.define(
    'QuranVerse',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      chapter_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'quran_chapters', key: 'id' },
      },
      verse_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      verse_key: {
        // "1:1", "2:255", etc. Denormalized for indexed lookup and easy
        // sharing between backend + client without a JOIN.
        type: DataTypes.STRING(15),
        allowNull: false,
      },
      // Uthmani script — the classical mushaf orthography.
      // (A dormant `text_indopak` column also exists in the schema
      // from migration 20260920000001; the model + code no longer
      // reference it. Safe to leave in the DB — nullable and unused.)
      text_uthmani:       { type: DataTypes.TEXT, allowNull: false },
      translation_text:   { type: DataTypes.TEXT, allowNull: true },
      translation_source: { type: DataTypes.STRING(150), allowNull: true },
    },
    {
      tableName: 'quran_verses',
      indexes: [
        { fields: ['chapter_id'] },
        { fields: ['verse_key'] },
        // Matches the unique index in the migration; upsert relies on it.
        { unique: true, fields: ['chapter_id', 'verse_number'], name: 'quran_verses_chapter_verse_unique' },
      ],
    }
  );

  QuranVerse.associate = (models) => {
    QuranVerse.belongsTo(models.QuranChapter, {
      foreignKey: 'chapter_id',
      as: 'chapter',
    });
  };

  return QuranVerse;
};
