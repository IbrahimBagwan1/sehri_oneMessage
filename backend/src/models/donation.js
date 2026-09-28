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
      // Nullable on purpose: when a member erases their account the
      // donation record survives them with user_id set to NULL, because
      // the community reconciles its books against these rows. Treat a
      // null user as "a former member" — never as a missing donation.
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
      },
      // Rupees + paise. Max 10 digits — up to 99,999,999.99.
      amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: { min: 1 },
      },
      // Optional free-form note (kept for backwards compatibility; the
      // frontend no longer surfaces it but existing rows may have one).
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Cloudinary secure URL for the payment screenshot. Required on
      // fresh submissions (enforced in the controller) but nullable at
      // the DB layer so legacy rows without a screenshot still validate.
      screenshot_url: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // Cloudinary delivery — see migration 20260928000005 and
      // cloudinaryService.screenshotViewUrl. Never serialise these rows
      // straight to a client: screenshot_url must be replaced by a view URL.
      screenshot_public_id: { type: DataTypes.STRING(255), allowNull: true },
      screenshot_format:    { type: DataTypes.STRING(10), allowNull: true },
      screenshot_access: {
        type: DataTypes.ENUM('public', 'authenticated'),
        allowNull: false,
        defaultValue: 'public',
      },
      status: {
        type: DataTypes.ENUM('pending', 'verified', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // Only set when status = 'rejected'. Optional short explanation
      // shown to the user in their history.
      rejection_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // super_admin.id of the reviewer — nullable until reviewed.
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
        { fields: ['status', 'created_at'], name: 'idx_donations_status_created' },
      ],
    }
  );

  Donation.associate = (models) => {
    Donation.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return Donation;
};
