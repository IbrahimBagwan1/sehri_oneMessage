'use strict';

module.exports = (sequelize, DataTypes) => {
  const Broadcast = sequelize.define(
    'Broadcast',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: { notEmpty: true, len: [1, 2000] },
      },
      target_location_id: {
        // NULL — broadcast to every approved user (all zones).
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'locations', key: 'id' },
      },
      sent_by: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      recipient_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      delivered_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'broadcasts',
      indexes: [
        { fields: ['sent_by'] },
        { fields: ['target_location_id'] },
        { fields: ['created_at'] },
      ],
    }
  );

  Broadcast.associate = (models) => {
    Broadcast.belongsTo(models.Location, {
      foreignKey: 'target_location_id',
      as: 'target_location',
    });
  };

  return Broadcast;
};
