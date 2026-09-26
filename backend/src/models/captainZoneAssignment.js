'use strict';

// -----------------------------------------------------------------------------
// CaptainZoneAssignment — which zones a captain is responsible for.
//
// One row per (captain, zone). The zone side is UNIQUE, so a zone has at most
// one captain and a delivery stop therefore has exactly one owner. See the
// migration for why that is a hard constraint rather than a warning.
//
// This is persistent configuration, not a nightly choice: the roster is set
// once and the delivery run is generated from it each night.
// -----------------------------------------------------------------------------

module.exports = (sequelize, DataTypes) => {
  const CaptainZoneAssignment = sequelize.define(
    'CaptainZoneAssignment',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      captain_rider_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'riders', key: 'id' },
      },
      zone_location_id: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: 'uq_captain_zone_assignments_zone',
        references: { model: 'locations', key: 'id' },
      },
    },
    {
      tableName: 'captain_zone_assignments',
      indexes: [
        { unique: true, fields: ['zone_location_id'], name: 'uq_captain_zone_assignments_zone' },
        { fields: ['captain_rider_id'], name: 'idx_captain_zone_assignments_captain' },
      ],
    }
  );

  CaptainZoneAssignment.associate = (models) => {
    CaptainZoneAssignment.belongsTo(models.Rider, {
      foreignKey: 'captain_rider_id',
      as: 'captain',
    });
    CaptainZoneAssignment.belongsTo(models.Location, {
      foreignKey: 'zone_location_id',
      as: 'zone',
    });
  };

  return CaptainZoneAssignment;
};
