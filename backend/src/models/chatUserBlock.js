'use strict';

// -----------------------------------------------------------------------------
// ChatUserBlock — "I do not want to see this person's messages."
//
// ONE-WAY, deliberately. The blocker stops seeing the blocked person; the
// blocked person's view of the group is unchanged and they are never told.
// The reasoning is in services/chatModerationService.js, where the filtering
// happens.
//
// Polymorphic on both sides, matching chat_messages.sender_id / sender_type:
// a user can block an admin, an admin can block a user, and each identity
// lives in a different table, so there are no foreign keys here.
// -----------------------------------------------------------------------------

module.exports = (sequelize, DataTypes) => {
  const ChatUserBlock = sequelize.define(
    'ChatUserBlock',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      blocker_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      blocker_type: {
        type: DataTypes.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
      },
      blocked_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      blocked_type: {
        type: DataTypes.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
      },
    },
    {
      tableName: 'chat_user_blocks',
      indexes: [
        {
          unique: true,
          fields: ['blocker_id', 'blocker_type', 'blocked_id', 'blocked_type'],
          name: 'uq_chat_user_blocks_pair',
        },
        { fields: ['blocker_id', 'blocker_type'], name: 'idx_chat_user_blocks_blocker' },
      ],
    }
  );

  return ChatUserBlock;
};
