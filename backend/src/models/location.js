'use strict';

module.exports = (sequelize, DataTypes) => {
  const Location = sequelize.define(
    'Location',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      // Hierarchy: city → region → area → zone → address.
      // 'region' sits between city and area (e.g. "South Bangalore").
      // Consumers must NOT assume a fixed depth — walk parent_id instead,
      // since a chain may legitimately skip levels for smaller cities.
      type: {
        type: DataTypes.ENUM('city', 'region', 'area', 'zone', 'address'),
        allowNull: false,
      },
      parent_id: {
        type: DataTypes.UUID,
        allowNull: true, // NULL only for type='city' (top of chain)
        references: {
          model: 'locations',
          key: 'id',
        },
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // Geographic pin — populated once per address by the super admin
      // via the coordinate-picker screen. Nullable for city/area/zone
      // rows (they don't need pins) and for any address row that hasn't
      // been geocoded yet. ETA calculator silently skips destinations
      // without coordinates so the feature degrades gracefully.
      latitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
      },
      longitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
      },
      geocoded_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'locations',
      indexes: [
        { fields: ['parent_id'] },
        { fields: ['type'] },
      ],
      validate: {
  parentRequiredUnlessCity() {
    if (this.type !== 'city' && !this.parent_id) {
      throw new Error(`A location of type '${this.type}' must have a parent_id.`);
    }
    if (this.type === 'city' && this.parent_id) {
      throw new Error(`A location of type 'city' cannot have a parent_id.`);
    }
  },
},
    }
  );

  Location.associate = (models) => {
    // Self-referencing chain: a location has one parent, and many children
    Location.belongsTo(Location, { as: 'parent', foreignKey: 'parent_id' });
    Location.hasMany(Location, { as: 'children', foreignKey: 'parent_id' });

    // A zone-level location can have many users
    Location.hasMany(models.User, { foreignKey: 'location_id', as: 'users' });
  };

  return Location;
};
