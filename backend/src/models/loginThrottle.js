'use strict';

/**
 * LoginThrottle — failed sign-in attempts per phone number.
 * See services/loginThrottleService.js.
 */
module.exports = (sequelize, DataTypes) => {
  const LoginThrottle = sequelize.define(
    'LoginThrottle',
    {
      phone: {
        type: DataTypes.STRING(15),
        primaryKey: true,
        allowNull: false,
      },
      failures: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      window_started_at: { type: DataTypes.DATE, allowNull: true },
      lockouts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      locked_until: { type: DataTypes.DATE, allowNull: true },
    },
    { tableName: 'login_throttles' }
  );
  return LoginThrottle;
};
