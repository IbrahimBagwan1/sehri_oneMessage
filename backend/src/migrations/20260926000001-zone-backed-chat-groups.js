'use strict';

/**
 * Makes chat groups zone-aware.
 *
 * Until now every group was assembled by hand: a super admin created one and
 * picked each member. That does not scale with the community — a new member
 * joins a zone and nobody thinks to add them to the zone's chat, so the chat
 * quietly stops representing the zone.
 *
 * Three additions turn that around:
 *
 *   chat_group_zones            Which zones a group covers. A join table
 *                               rather than a column on chat_groups because a
 *                               super admin can attach a SECOND zone to a
 *                               group (e.g. one chat spanning both hostels).
 *
 *   chat_groups.is_default      Marks the group provisioned automatically for
 *                               a zone. Exactly one per zone; it is what stops
 *                               the provisioner creating duplicates, and what
 *                               stops the delete endpoint removing a group the
 *                               app would immediately recreate.
 *
 *   chat_group_members.source   'auto'   — membership derived from the zone
 *                                          links (approved members of the
 *                                          zone, its admins, every super
 *                                          admin). Reconciled continuously,
 *                                          and not removable by hand.
 *                               'manual' — someone a super admin added on
 *                                          purpose. Never touched by the
 *                                          reconciler; removable.
 *
 * Existing rows default to 'manual', which is exactly what they are.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('chat_group_zones', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      group_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'chat_groups', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      // Points at a locations row of type='zone'. Enforced in the service
      // layer: MySQL cannot express "FK, but only to rows of one type".
      zone_location_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'locations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('chat_group_zones', ['group_id', 'zone_location_id'], {
      unique: true,
      name: 'chat_group_zones_group_id_zone_location_id',
    });
    await queryInterface.addIndex('chat_group_zones', ['zone_location_id'], {
      name: 'chat_group_zones_zone_location_id',
    });

    await queryInterface.addColumn('chat_groups', 'is_default', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addIndex('chat_groups', ['is_default'], {
      name: 'chat_groups_is_default',
    });

    // Every group that exists today was hand-assembled, so 'manual' is both
    // the right default for new rows and the right backfill for old ones.
    await queryInterface.sequelize.query(
      "ALTER TABLE `chat_group_members` ADD COLUMN `source` " +
      "ENUM('auto','manual') NOT NULL DEFAULT 'manual' AFTER `user_type`;"
    );
    await queryInterface.addIndex('chat_group_members', ['group_id', 'source'], {
      name: 'chat_group_members_group_id_source',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('chat_group_members', 'chat_group_members_group_id_source');
    await queryInterface.removeColumn('chat_group_members', 'source');
    await queryInterface.removeIndex('chat_groups', 'chat_groups_is_default');
    await queryInterface.removeColumn('chat_groups', 'is_default');
    await queryInterface.dropTable('chat_group_zones');
  },
};
