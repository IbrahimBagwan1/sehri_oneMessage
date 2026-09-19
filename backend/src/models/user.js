'use strict';

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define(
    'User',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { notEmpty: true },
      },
      phone: {
        type: DataTypes.STRING(15),
        allowNull: false,
        unique: true,
        validate: {
          is: /^[6-9]\d{9}$/, // Indian mobile number, 10 digits starting 6-9
        },
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false, // stored as bcrypt hash, never plaintext
      },
      gender: {
        type: DataTypes.ENUM('male', 'female'),
        allowNull: false,
      },
      occupation: {
        type: DataTypes.ENUM('student', 'employee', 'others'),
        allowNull: false,
      },
      city: {
        type: DataTypes.STRING(100),
        defaultValue: 'Bangalore',
      },
      location_id: {
        // Points to the leaf-level (zone) row in the locations parent-chain table
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'locations',
          key: 'id',
        },
      },
      address: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      status: {
        // 'deleted' is used by the account soft-delete flow. Rows in that
        // state have their PII anonymized but keep their id so FKs from
        // poll_responses, donations, etc. stay valid.
        type: DataTypes.ENUM('pending', 'approved', 'rejected', 'deleted'),
        defaultValue: 'pending',
      },
      is_phone_verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      fcm_token: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      profile_picture: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'users',
      indexes: [
        { unique: true, fields: ['phone'] },
        { fields: ['location_id'] },
        { fields: ['status'] },
      ],
      defaultScope: {
        // password is never returned unless explicitly requested via .scope('withPassword')
        attributes: { exclude: ['password'] },
      },
      scopes: {
        withPassword: {
          attributes: {},
        },
      },
    }
  );

  User.associate = (models) => {
    User.belongsTo(models.Location, { foreignKey: 'location_id', as: 'location' });
  };

  return User;
};
