'use strict';

module.exports = (sequelize, DataTypes) => {
  const QuranChapter = sequelize.define(
    'QuranChapter',
    {
      id: {
        // Surah number 1..114. Deliberately INT (not UUID) — the canonical
        // numbering is part of the domain, and pinning it to the PK keeps
        // URLs and verse_keys ("2:255") natural.
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false,
      },
      name_arabic:      { type: DataTypes.STRING(100), allowNull: false },
      name_simple:      { type: DataTypes.STRING(100), allowNull: false },
      translated_name:  { type: DataTypes.STRING(150), allowNull: true },
      revelation_place: { type: DataTypes.ENUM('meccan', 'medinan'), allowNull: false },
      verses_count:     { type: DataTypes.INTEGER, allowNull: false },
      bismillah_pre:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: 'quran_chapters',
      indexes: [
        { fields: ['revelation_place'] },
        { fields: ['name_simple'] },
      ],
    }
  );

  QuranChapter.associate = (models) => {
    QuranChapter.hasMany(models.QuranVerse, {
      foreignKey: 'chapter_id',
      as: 'verses',
    });
  };

  return QuranChapter;
};
