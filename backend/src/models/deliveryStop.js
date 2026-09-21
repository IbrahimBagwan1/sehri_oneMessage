'use strict';

// -----------------------------------------------------------------------------
// DeliveryStop — replaces the "single assigned_rider_id per poll" model.
// One row per (poll, rider, PG). See the migration for column intent.
// -----------------------------------------------------------------------------

module.exports = (sequelize, DataTypes) => {
  const DeliveryStop = sequelize.define(
    'DeliveryStop',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      poll_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'polls', key: 'id' },
      },
      rider_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'riders', key: 'id' },
      },
      location_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'locations', key: 'id' },
      },
      packet_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('pending', 'delivered', 'skipped'),
        allowNull: false,
        defaultValue: 'pending',
      },
      delivered_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      delivered_by_rider_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'riders', key: 'id' },
      },
    },
    {
      tableName: 'delivery_stops',
      indexes: [
        {
          unique: true,
          fields: ['poll_id', 'rider_id', 'location_id'],
          name: 'uq_delivery_stops_poll_rider_location',
        },
        { fields: ['poll_id', 'rider_id'] },
        { fields: ['poll_id', 'location_id'] },
        { fields: ['poll_id'] },
        { fields: ['status'] },
      ],
    }
  );

  DeliveryStop.associate = (models) => {
    DeliveryStop.belongsTo(models.Poll,     { foreignKey: 'poll_id',     as: 'poll' });
    DeliveryStop.belongsTo(models.Rider,    { foreignKey: 'rider_id',    as: 'rider' });
    DeliveryStop.belongsTo(models.Location, { foreignKey: 'location_id', as: 'location' });
    DeliveryStop.belongsTo(models.Rider, {
      foreignKey: 'delivered_by_rider_id',
      as: 'delivered_by',
    });
  };

  return DeliveryStop;
};
