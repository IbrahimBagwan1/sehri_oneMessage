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
      // The zone this rider BELONGS TO as a person — carried in their JWT
      // and used by the socket layer to scope what they may watch.
      //
      // This no longer decides delivery coverage. Which zones a captain is
      // responsible for lives in captain_zone_assignments; see
      // services/deliveryTeamService.js. A captain may cover several zones,
      // which a single column cannot express.
      zone_location_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'locations',
          key: 'id',
        },
      },
      // The helper riding with this captain tonight, or null for a solo run.
      //
      // UNIQUE, so one person cannot be two captains' helper — they ride one
      // bike. NULL repeats freely in a MySQL unique index, so any number of
      // captains may work solo.
      //
      // The pair is a team: they share one route, one stop list, and one
      // completion state, all keyed to the CAPTAIN. The helper never gets
      // stops of their own.
      helper_rider_id: {
        type: DataTypes.UUID,
        allowNull: true,
        defaultValue: null,
        unique: 'uq_riders_helper',
        references: {
          model: 'riders',
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
        { unique: true, fields: ['helper_rider_id'], name: 'uq_riders_helper' },
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

    // --- Team structure ---------------------------------------------------
    // The zones this rider is captain of. Empty for a helper or for a rider
    // who is not on the roster; captaincy IS having assignments, so there is
    // no separate role column to fall out of sync with this.
    Rider.hasMany(models.CaptainZoneAssignment, {
      foreignKey: 'captain_rider_id',
      as: 'zone_assignments',
    });

    // Self-referencing, both directions of the same column:
    //   rider.helper  — the person riding with me (I am a captain)
    //   rider.captain — the person I ride with   (I am a helper)
    Rider.belongsTo(models.Rider, { foreignKey: 'helper_rider_id', as: 'helper' });
    Rider.hasOne(models.Rider,    { foreignKey: 'helper_rider_id', as: 'captain' });
  };

  return Rider;
};
