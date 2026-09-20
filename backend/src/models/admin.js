'use strict';

module.exports = (sequelize, DataTypes) => {
  const Admin = sequelize.define(
    'Admin',
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
      zone_location_id: {
        // Must reference a locations row where type = 'zone'.
        // Enforced in the controller that creates admins, not here,
        // since Sequelize validators can't easily do async lookups.
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'locations',
          key: 'id',
        },
      },
      fcm_token: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // When set, this admin is also a registered user.
      // Carrying user_id in the JWT lets them vote and access user-scoped
      // routes without a second login.
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'users',
          key: 'id',
        },
      },
      // Promotion audit — set when this admin row was created by
      // POST /api/admin/users/:id/promote (super admin promoted an
      // existing user). Nullable — standalone admins created without
      // going through the promotion flow leave these blank.
      promoted_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      promoted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'admins',
      indexes: [
        { unique: true, fields: ['phone'] },
        { fields: ['zone_location_id'] },
        { fields: ['promoted_by'] },
      ],
      defaultScope: {
        attributes: { exclude: ['password'] },
      },
      scopes: {
        withPassword: {
          attributes: {},
        },
      },
    }
  );

  Admin.associate = (models) => {
    Admin.belongsTo(models.Location, { foreignKey: 'zone_location_id', as: 'zone' });
    // Optional link to a users row — set when this admin is also a resident.
    Admin.belongsTo(models.User, { foreignKey: 'user_id', as: 'user_account' });
  };

  return Admin;
};