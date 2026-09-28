'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('otps', 'verification_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('otps', 'provider', {
      type: Sequelize.ENUM('local', 'messagecentral'),
      allowNull: false,
      defaultValue: 'local',
    });

    await queryInterface.changeColumn('otps', 'otp_hash', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    // Provider-verified rows have no local hash and cannot satisfy NOT NULL.
    // OTPs are minutes-lived, so dropping them is harmless.
    await queryInterface.sequelize.query('DELETE FROM otps WHERE otp_hash IS NULL');
    await queryInterface.changeColumn('otps', 'otp_hash', {
      type: Sequelize.STRING,
      allowNull: false,
    });

    await queryInterface.removeColumn('otps', 'provider');
    await queryInterface.removeColumn('otps', 'verification_id');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_otps_provider";');
    }
  },
};
