'use strict';

module.exports = (sequelize, DataTypes) => {
  const Feedback = sequelize.define(
    'Feedback',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Nullable on purpose — see donation.js. An erased account leaves
      // its feedback in the admin inbox, detached from any identity, so
      // an open complaint doesn't silently disappear mid-review.
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      category: {
        type: DataTypes.ENUM('suggestion', 'complaint', 'bug', 'appreciation', 'other'),
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 2000],
        },
      },
      is_read: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // admin.id or super_admin.id — kept polymorphic; controller resolves.
      read_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      read_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'feedback',
      indexes: [
        { fields: ['user_id'] },
        { fields: ['category'] },
        { fields: ['is_read'] },
        { fields: ['created_at'] },
      ],
    }
  );

  Feedback.associate = (models) => {
    Feedback.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return Feedback;
};
