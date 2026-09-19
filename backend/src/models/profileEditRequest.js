'use strict';

module.exports = (sequelize, DataTypes) => {
  const ProfileEditRequest = sequelize.define(
    'ProfileEditRequest',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      // JSON blob of allow-listed fields the user wants to change.
      // See EDITABLE_PROFILE_FIELDS in userController.js.
      requested_changes: {
        type: DataTypes.JSON,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // super_admin.id of the reviewer. Kept as a plain UUID (super_admins
      // is a separate table — cross-table FK adds migration noise).
      reviewed_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      admin_note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'profile_edit_requests',
      indexes: [
        { fields: ['user_id'] },
        { fields: ['status'] },
        { fields: ['user_id', 'status'] },
      ],
    }
  );

  ProfileEditRequest.associate = (models) => {
    ProfileEditRequest.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user',
    });
  };

  return ProfileEditRequest;
};
