'use strict';

module.exports = (sequelize, DataTypes) => {
  const Rider = sequelize.define(
    'Rider',
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
      phone: {
        type: DataTypes.STRING(15),
        allowNull: false,
        unique: true,
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      // The zone this rider serves. Null = serves all zones.
      zone_location_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'locations',
          key: 'id',
        },
      },
      // Optional link to a users row — same pattern as Admin.
      // When set, the rider JWT carries user_id so they can vote, chat,
      // view prayer times etc. without a separate login.
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      // Live GPS — updated by the rider app every 5 seconds.
      latitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
      },
      longitude: {
        type: DataTypes.DECIMAL(10, 7),
        allowNull: true,
      },
      // Reverse-geocoded on the device and sent as a plain string.
      // No server-side geocoding needed.
      current_address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Estimated minutes to arrival — set by the rider app.
      eta_minutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // idle       = on duty but not yet delivering
      // delivering = actively out with food
      // done       = today's run complete
      status: {
        type: DataTypes.ENUM('idle', 'delivering', 'done'),
        defaultValue: 'idle',
      },
      // Super admin toggles this to put rider on/off duty.
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: 'riders',
      indexes: [
        { unique: true, fields: ['phone'] },
        { fields: ['zone_location_id'] },
        { fields: ['is_active'] },
        { fields: ['status'] },
      ],
      defaultScope: {
        // Never return the password unless explicitly requested.
        attributes: { exclude: ['password'] },
      },
      scopes: {
        withPassword: {
          attributes: {},
        },
      },
    }
  );

  Rider.associate = (models) => {
    // Which zone they serve
    Rider.belongsTo(models.Location, {
      foreignKey: 'zone_location_id',
      as: 'zone',
    });
    // Optional linked user account
    Rider.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user_account',
    });
  };

  return Rider;
};
