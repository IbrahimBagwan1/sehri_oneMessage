'use strict';

module.exports = (sequelize, DataTypes) => {
  const ChatGroupZone = sequelize.define(
    'ChatGroupZone',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      group_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'chat_groups', key: 'id' },
      },
      // A locations row of type='zone'. The "only zones" part cannot be
      // expressed as a constraint, so chatGroupSync validates it before
      // linking — see addZone in chatController.
      zone_location_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'locations', key: 'id' },
      },
    },
    {
      tableName: 'chat_group_zones',
      indexes: [
        { unique: true, fields: ['group_id', 'zone_location_id'] },
        { fields: ['zone_location_id'] },
      ],
    }
  );

  ChatGroupZone.associate = (models) => {
    ChatGroupZone.belongsTo(models.ChatGroup, { foreignKey: 'group_id', as: 'group' });
    ChatGroupZone.belongsTo(models.Location,  { foreignKey: 'zone_location_id', as: 'zone' });
  };

  return ChatGroupZone;
};
