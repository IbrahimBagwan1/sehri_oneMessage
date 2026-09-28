'use strict';

/**
 * LoginThrottle — failed sign-in counters, keyed by throttle_key
 * ("pi:<phone>:<source>" or "p:<phone>"). See
 * services/loginThrottleService.js and migration
 * 20260928000003-login-throttle-per-source.js.
 */
module.exports = (sequelize, DataTypes) => {
  const LoginThrottle = sequelize.define(
    'LoginThrottle',
    {
      throttle_key: {
        type: DataTypes.STRING(120),
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
