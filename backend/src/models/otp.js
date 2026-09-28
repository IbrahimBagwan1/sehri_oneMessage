'use strict';
module.exports = (sequelize, DataTypes) => {
  const OTP = sequelize.define(
    'OTP',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      phone: {
        type: DataTypes.STRING(15),
        allowNull: false,
      },
      otp_hash: {
        // Only present for provider = 'local'. MessageCentral-provider rows
        // never populate this - MessageCentral owns OTP generation for
        // those, so there's no plaintext code on our side to hash.
        type: DataTypes.STRING,
        allowNull: true,
      },
      verification_id: {
        // Only present for provider = 'messagecentral'. This is MessageCentral's
        // reference ID for the send request - not a secret, just a lookup key
        // passed to their validateOtp API.
        type: DataTypes.STRING,
        allowNull: true,
      },
      provider: {
        // Which system generated + will verify this OTP. All verification
        // logic branches on this field explicitly.
        type: DataTypes.ENUM('local', 'messagecentral'),
        allowNull: false,
        defaultValue: 'local',
      },
      purpose: {
        type: DataTypes.ENUM('registration', 'forgot_password'),
        allowNull: false,
      },
      role: {
        // Which table to check/update against once verified.
        // Registration OTPs are always 'user'; forgot-password can be any role.
        type: DataTypes.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
        defaultValue: 'user',
      },
      attempts: {
        // Number of failed verification attempts against this OTP.
        // Locked out after MAX_OTP_ATTEMPTS (enforced in the service layer).
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },
      is_used: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      tableName: 'otps',
      indexes: [
        { fields: ['phone'] },
        { fields: ['phone', 'purpose'] },
        { fields: ['expires_at'] },
        { fields: ['phone', 'created_at'], name: 'idx_otps_phone_created' },
      ],
    }
  );
  return OTP;
};