'use strict';

module.exports = (sequelize, DataTypes) => {
  const Dua = sequelize.define(
    'Dua',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      category_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'dua_categories', key: 'id' },
      },
      slug: {
        // Stable upstream identifier — globally unique so
        // /v1/dhikr/entry/{slug} maps 1:1.
        type: DataTypes.STRING(150),
        allowNull: false,
        unique: true,
      },
      name:            { type: DataTypes.STRING(255), allowNull: false },
      arabic_text:     { type: DataTypes.TEXT, allowNull: false },
      transliteration: { type: DataTypes.TEXT, allowNull: true },
      translation:     { type: DataTypes.TEXT, allowNull: true },
      source:          { type: DataTypes.STRING(255), allowNull: true },
      order_index:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'duas',
      indexes: [
        { fields: ['category_id'] },
        { unique: true, fields: ['slug'] },
        { fields: ['category_id', 'order_index'] },
      ],
    }
  );

  Dua.associate = (models) => {
    Dua.belongsTo(models.DuaCategory, {
      foreignKey: 'category_id',
      as: 'category',
    });
  };

  return Dua;
};
