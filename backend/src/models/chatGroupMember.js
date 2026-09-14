'use strict';

module.exports = (sequelize, DataTypes) => {
  const ChatGroupMember = sequelize.define(
    'ChatGroupMember',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      group_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'chat_groups',
          key: 'id',
        },
      },
      // The actual UUID of the member — points to users, admins, or
      // super_admins table depending on user_type below.
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Discriminator so the controller knows which table to JOIN when
      // fetching member profiles.
      user_type: {
        type: DataTypes.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
      },
      // Tracks how many messages this member has read up to.
      // The controller compares this against total message count to
      // derive the unread badge count.
      last_read_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      tableName: 'chat_group_members',
      indexes: [
        // One membership record per user per group.
        { unique: true, fields: ['group_id', 'user_id'] },
        { fields: ['group_id'] },
        { fields: ['user_id'] },
      ],
    }
  );

  ChatGroupMember.associate = (models) => {
    ChatGroupMember.belongsTo(models.ChatGroup, {
      foreignKey: 'group_id',
      as: 'group',
    });
  };

  return ChatGroupMember;
};
