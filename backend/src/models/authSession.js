'use strict';

/**
 * AuthSession — one signed-in device. See the migration
 * 20260928000001-auth-sessions-and-poll-override.js and
 * services/authSessionService.js for how rotation and revocation work.
 */
module.exports = (sequelize, DataTypes) => {
  const AuthSession = sequelize.define(
    'AuthSession',
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      subject_type: {
        type: DataTypes.ENUM('user', 'admin', 'super_admin', 'rider'),
        allowNull: false,
      },
      subject_id: { type: DataTypes.UUID, allowNull: false },
      current_jti: { type: DataTypes.STRING(64), allowNull: false },
      previous_jti: { type: DataTypes.STRING(64), allowNull: true },
      rotated_at: { type: DataTypes.DATE, allowNull: true },
      last_used_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      revoked_reason: { type: DataTypes.STRING(40), allowNull: true },
    },
    {
      tableName: 'auth_sessions',
      indexes: [
        { fields: ['subject_type', 'subject_id'], name: 'idx_auth_sessions_subject' },
        { fields: ['expires_at'], name: 'idx_auth_sessions_expires' },
      ],
    }
  );
  return AuthSession;
};
