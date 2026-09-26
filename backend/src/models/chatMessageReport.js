'use strict';

// -----------------------------------------------------------------------------
// ChatMessageReport — one member flagging one message for moderation.
//
// WHY THE SNAPSHOT COLUMNS EXIST
// chatController.deleteMessage sets content to '[deleted]'. Someone who has
// just been reported can therefore erase the evidence with two taps, and a
// report that only held a message id would arrive at the moderator's screen
// saying nothing. message_snapshot is written once, at report time, and
// never updated — it is what the moderator actually reads.
//
// The reported person's name is snapshotted for the same reason: accounts
// can be erased (see utils/memberDisplay.js), and a queue entry reading
// "Former member" tells a moderator nothing about the pattern they are
// looking at.
// -----------------------------------------------------------------------------

module.exports = (sequelize, DataTypes) => {
  const ChatMessageReport = sequelize.define(
    'ChatMessageReport',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Nullable: the report outlives the message row.
      message_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'chat_messages', key: 'id' },
      },
      group_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'chat_groups', key: 'id' },
      },
      reporter_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      reporter_type: {
        type: DataTypes.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
      },
      reported_user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      reported_user_type: {
        type: DataTypes.ENUM('user', 'admin', 'super_admin'),
        allowNull: false,
      },
      // Optional. Making someone categorise abuse before they can escape it
      // is friction in the wrong place.
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      message_snapshot: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      reported_user_name_snapshot: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      reported_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      status: {
        type: DataTypes.ENUM('pending', 'reviewed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // 'none' is a real outcome: it separates "a moderator looked and
      // judged this fine" from "nobody has looked yet".
      action_taken: {
        type: DataTypes.ENUM('none', 'message_deleted', 'user_banned', 'both'),
        allowNull: true,
        defaultValue: null,
      },
      reviewed_by: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      reviewed_by_type: {
        type: DataTypes.ENUM('admin', 'super_admin'),
        allowNull: true,
      },
      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      review_note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'chat_message_reports',
      indexes: [
        {
          unique: true,
          fields: ['message_id', 'reporter_id', 'reporter_type'],
          name: 'uq_chat_message_reports_one_per_reporter',
        },
        { fields: ['status', 'created_at'], name: 'idx_chat_message_reports_queue' },
        { fields: ['group_id'], name: 'idx_chat_message_reports_group' },
        { fields: ['reported_user_id'], name: 'idx_chat_message_reports_reported' },
      ],
    }
  );

  ChatMessageReport.associate = (models) => {
    ChatMessageReport.belongsTo(models.ChatGroup, { foreignKey: 'group_id', as: 'group' });
    ChatMessageReport.belongsTo(models.ChatMessage, { foreignKey: 'message_id', as: 'message' });
  };

  return ChatMessageReport;
};
