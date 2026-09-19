'use strict';

module.exports = (sequelize, DataTypes) => {
  const Donation = sequelize.define(
    'Donation',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      // Rupees + paise. Max 10 digits — up to 99,999,999.99.
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 1, // reject non-positive amounts at the model layer
        },
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('pending', 'verified', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // admin.id of the verifier — nullable until reviewed.
      verified_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      verified_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'donations',
      indexes: [
        { fields: ['user_id'] },
        { fields: ['status'] },
        { fields: ['created_at'] },
        { fields: ['user_id', 'created_at'] },
      ],
    }
  );

  Donation.associate = (models) => {
    Donation.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return Donation;
};
