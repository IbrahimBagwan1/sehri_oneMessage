'use strict';

module.exports = (sequelize, DataTypes) => {
  const ChatMessage = sequelize.define(
    'ChatMessage',
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
      // UUID of the sender — points to users, admins, or super_admins
      // table depending on sender_type.
      sender_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // Discriminator — tells the controller which table to look up for
      // the sender's name/profile when returning messages.
      sender_type: {
        type: DataTypes.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
      },
      // The text content of the message.
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // Reply threading — if set, this message is a reply to another
      // message in the same group.  Null = top-level message.
      reply_to_id: {
        type: DataTypes.UUID,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'chat_messages',
          key: 'id',
        },
      },
      // Soft-delete: set to true by owner or super_admin via DELETE endpoint.
      // The row is kept so reply threads don't break; clients show
      // "This message was deleted" when is_deleted = true.
      is_deleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
    },
    {
      tableName: 'chat_messages',
      indexes: [
        // Primary access pattern: all messages for a group, newest first.
        { fields: ['group_id', 'created_at'] },
        { fields: ['sender_id'] },
        // Reply thread lookups.
        { fields: ['reply_to_id'] },
      ],
    }
  );

  ChatMessage.associate = (models) => {
    ChatMessage.belongsTo(models.ChatGroup, {
      foreignKey: 'group_id',
      as: 'group',
    });
    // Self-referential association for reply threading.
    ChatMessage.belongsTo(models.ChatMessage, {
      foreignKey: 'reply_to_id',
      as: 'replied_to',
    });
    ChatMessage.hasMany(models.ChatMessage, {
      foreignKey: 'reply_to_id',
      as: 'replies',
    });
  };

  return ChatMessage;
};
