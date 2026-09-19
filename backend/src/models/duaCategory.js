'use strict';

module.exports = (sequelize, DataTypes) => {
  const DuaCategory = sequelize.define(
    'DuaCategory',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      slug: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      name:         { type: DataTypes.STRING(150), allowNull: false },
      description:  { type: DataTypes.TEXT, allowNull: true },
      dua_count:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      order_index:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'dua_categories',
      indexes: [
        { unique: true, fields: ['slug'] },
        { fields: ['order_index'] },
      ],
    }
  );

  DuaCategory.associate = (models) => {
    DuaCategory.hasMany(models.Dua, {
      foreignKey: 'category_id',
      as: 'duas',
    });
  };

  return DuaCategory;
};
