'use strict';

// -----------------------------------------------------------------------------
// delivery_stops — one row per (poll, rider, PG). Replaces the single-rider
// assumption baked into polls.assigned_rider_id: multiple riders can be
// assigned to the same poll, each with their own subset of PGs.
//
// packet_count is a snapshot taken when the stop is generated so late votes
// or last-minute special-case decisions don't retroactively change what a
// rider is delivering to a given PG.
//
// sort_order is the position in the rider's current OPTIMIZED route — we
// re-compute it via Google Directions waypoint optimization whenever the
// rider starts delivery or completes a stop. It's an integer to keep the
// column type-simple; nulls sort at the end so freshly-generated stops with
// no computed order still list deterministically.
//
// status:
//   'pending'   — not yet delivered
//   'delivered' — rider marked it done (see delivered_at / delivered_by_rider_id)
//   'skipped'   — reserved for a future "couldn't deliver" flow; not written today
// -----------------------------------------------------------------------------

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('delivery_stops', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      poll_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'polls', key: 'id' },
        onDelete: 'CASCADE',
      },
      rider_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'riders', key: 'id' },
        onDelete: 'CASCADE',
      },
      location_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'locations', key: 'id' },
      },
      packet_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'delivered', 'skipped'),
        allowNull: false,
        defaultValue: 'pending',
      },
      delivered_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      delivered_by_rider_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'riders', key: 'id' },
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

    // A rider only ever has one stop per PG per poll — enforced at the DB
    // level so a duplicate assignment can't slip through a race.
    await queryInterface.addIndex('delivery_stops', ['poll_id', 'rider_id', 'location_id'], {
      unique: true,
      name: 'uq_delivery_stops_poll_rider_location',
    });
    // Query paths we hit constantly:
    //   • "which stops does this rider have today?" — (poll_id, rider_id)
    //   • "which rider serves this PG today?" — (poll_id, location_id)
    //   • "who's assigned today at all?" — poll_id
    await queryInterface.addIndex('delivery_stops', ['poll_id', 'rider_id'], {
      name: 'idx_delivery_stops_poll_rider',
    });
    await queryInterface.addIndex('delivery_stops', ['poll_id', 'location_id'], {
      name: 'idx_delivery_stops_poll_location',
    });
    await queryInterface.addIndex('delivery_stops', ['poll_id'], {
      name: 'idx_delivery_stops_poll',
    });
    await queryInterface.addIndex('delivery_stops', ['status'], {
      name: 'idx_delivery_stops_status',
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeIndex('delivery_stops', 'uq_delivery_stops_poll_rider_location');
    await queryInterface.removeIndex('delivery_stops', 'idx_delivery_stops_poll_rider');
    await queryInterface.removeIndex('delivery_stops', 'idx_delivery_stops_poll_location');
    await queryInterface.removeIndex('delivery_stops', 'idx_delivery_stops_poll');
    await queryInterface.removeIndex('delivery_stops', 'idx_delivery_stops_status');
    await queryInterface.dropTable('delivery_stops');
  },
};
