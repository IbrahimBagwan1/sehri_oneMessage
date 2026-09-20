'use strict';
module.exports = (sequelize, DataTypes) => {
  const SuperAdmin = sequelize.define(
    'SuperAdmin',
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
      fcm_token: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
      // When set, this super admin is also a registered user.
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
      // Promotion audit — set when this super admin row was created by
      // POST /api/admin/users/:id/promote (an existing super admin
      // promoted a user). Nullable — standalone super admins leave
      // these blank.
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
      tableName: 'super_admins',
      indexes: [
        { unique: true, fields: ['phone'] },
        { fields: ['user_id'] },
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

  SuperAdmin.associate = (models) => {
    // Optional link to a users row — set when this super admin is also a resident.
    SuperAdmin.belongsTo(models.User, { foreignKey: 'user_id', as: 'user_account' });
  };

  return SuperAdmin;
};
