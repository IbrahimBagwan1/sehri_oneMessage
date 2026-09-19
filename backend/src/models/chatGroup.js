'use strict';

module.exports = (sequelize, DataTypes) => {
  const ChatGroup = sequelize.define(
    'ChatGroup',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Display name shown in the group list (e.g. "General Announcements")
      name: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { notEmpty: true },
      },
      // Optional short description / purpose of the group
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // UUID of the super_admin who created the group.
      // Stored as a plain UUID — not a FK — because super_admins is a
      // separate table and Sequelize cross-table FK constraints on UUID
      // columns need explicit migration steps.  We resolve the name in
      // the controller when needed.
      created_by: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Soft-delete flag. Deleted groups are hidden from members but
      // messages are preserved for audit purposes.
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: 'chat_groups',
      indexes: [
        { fields: ['created_by'] },
        { fields: ['is_active'] },
      ],
    }
  );

  ChatGroup.associate = (models) => {
    // A group has many members
    ChatGroup.hasMany(models.ChatGroupMember, {
      foreignKey: 'group_id',
      as: 'members',
    });
    // A group has many messages
    ChatGroup.hasMany(models.ChatMessage, {
      foreignKey: 'group_id',
      as: 'messages',
    });
  };

  return ChatGroup;
};
