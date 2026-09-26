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
      // How this membership came about.
      //   'auto'   — derived from the group's zone links: approved members
      //              of those zones, their zone admins, and every super
      //              admin. Owned by services/chatGroupSync.js, reconciled
      //              continuously, and refused by the remove endpoint —
      //              these are the people who must be in the room.
      //   'manual' — added deliberately by a super admin. The reconciler
      //              never touches these, and they can be removed.
      source: {
        type: DataTypes.ENUM('auto', 'manual'),
        allowNull: false,
        defaultValue: 'manual',
      },
      // Tracks how many messages this member has read up to.
      // The controller compares this against total message count to
      // derive the unread badge count.
      last_read_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      // Moderation: this member may read the group but not post in it.
      //
      // A BAN rather than a removal, because removal does not stick. An
      // 'auto' member is in the room because the group's zones put them
      // there, and services/chatGroupSync.js re-adds anyone entitled who
      // is missing — so deleting the row of an abusive member would be
      // silently undone on the next reconcile. The row stays; this flag is
      // what sendMessage checks, and the reconciler preserves it.
      is_banned: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      banned_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // admin.id or super_admin.id — polymorphic, resolved by the controller.
      banned_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      ban_reason: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'chat_group_members',
      indexes: [
        // One membership record per user per group.
        { unique: true, fields: ['group_id', 'user_id'] },
        { fields: ['group_id'] },
        { fields: ['user_id'] },
        { fields: ['group_id', 'source'] },
        { fields: ['group_id', 'is_banned'], name: 'idx_chat_group_members_banned' },
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
