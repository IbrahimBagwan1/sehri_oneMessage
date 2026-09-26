'use strict';

/**
 * Delivery teams: a Captain who drives, and optionally one Helper who rides
 * along and hands parcels to people.
 *
 * WHAT THIS REPLACES
 * Coverage used to be one nullable column, riders.zone_location_id, holding a
 * single zone or NULL for "serves everywhere". Each night a super admin
 * passed a list of rider ids and the backend round-robined every PG in a zone
 * across whichever of those riders matched it.
 *
 * That model cannot express the thing the community actually needs. Two
 * riders who both cover a zone SPLIT it, alternating PGs — so their routes
 * interleave across the same streets, and the question "who is delivering to
 * my PG" has an answer that changes every time anyone re-runs assign. What is
 * wanted instead is ownership: a captain is responsible for a set of zones,
 * start to finish, independently of every other captain.
 *
 * TWO CONSTRAINTS, BOTH ENFORCED BY THE DATABASE
 *
 *   captain_zone_assignments.zone_location_id is UNIQUE
 *     A zone has at most one captain. Overlap is not a warning here, it is
 *     impossible. Everything downstream depends on it: a delivery stop
 *     belongs to exactly one captain, and a resident's "where is my food"
 *     lookup walks PG -> zone -> captain and must land on one answer. Two
 *     captains sharing a zone would mean two people riding to the same PG
 *     with the same packets while the resident tracks whichever row the
 *     query happened to return first.
 *
 *   riders.helper_rider_id is UNIQUE
 *     A helper rides one bike. Without this, two captains could both name the
 *     same person and both believe they had a helper. NULL repeats freely in
 *     a MySQL unique index, which is exactly what is wanted — most riders
 *     have no helper.
 *
 * The rider table itself is unchanged in shape: a captain and a helper are
 * both riders. Captaincy is having zone assignments; being a helper is having
 * a captain point at you. Neither is a stored role column, because a stored
 * role is a second source of truth that drifts from the assignments the
 * moment anyone edits one without the other.
 *
 * riders.zone_location_id is deliberately LEFT IN PLACE. It still describes
 * which zone a rider belongs to as a person, it is carried in their JWT, and
 * the socket layer reads it. What it no longer decides is coverage.
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const q = queryInterface.sequelize;

    // -----------------------------------------------------------------
    // 1. captain_zone_assignments
    // -----------------------------------------------------------------
    await queryInterface.createTable('captain_zone_assignments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      captain_rider_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'riders', key: 'id' },
        onUpdate: 'CASCADE',
        // Deleting a captain releases their zones rather than leaving rows
        // pointing at nobody. The zones then show as uncovered in the
        // roster, which is the honest state and the one an admin can act on.
        onDelete: 'CASCADE',
      },
      zone_location_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'locations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // The constraint the whole model rests on — one captain per zone.
    await queryInterface.addIndex('captain_zone_assignments', ['zone_location_id'], {
      unique: true,
      name: 'uq_captain_zone_assignments_zone',
    });
    await queryInterface.addIndex('captain_zone_assignments', ['captain_rider_id'], {
      name: 'idx_captain_zone_assignments_captain',
    });

    // -----------------------------------------------------------------
    // 2. riders.helper_rider_id
    // -----------------------------------------------------------------
    await queryInterface.addColumn('riders', 'helper_rider_id', {
      type: Sequelize.UUID,
      allowNull: true,
      defaultValue: null,
      references: { model: 'riders', key: 'id' },
      onUpdate: 'CASCADE',
      // A helper who is deleted leaves their captain working solo, which is
      // a valid state. CASCADE here would delete the captain too.
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('riders', ['helper_rider_id'], {
      unique: true,
      name: 'uq_riders_helper',
    });

    // -----------------------------------------------------------------
    // 3. Backfill from the old single-zone column.
    //
    // Priority matters. A rider with an explicit zone stated it; a rider
    // with NULL only ever meant "wherever nobody else is", so they are
    // resolved second and take whatever is left. Doing it the other way
    // round would hand every zone to the all-zones rider and leave the
    // explicit assignment to fail against the unique index.
    //
    // Only ONE all-zones rider is expanded. Two riders who both meant
    // "everywhere" cannot both be given everywhere, and picking between
    // them is an operational decision, not a migration's to make: the
    // second is left with no zones and shows up in the roster as a captain
    // with nothing assigned.
    // -----------------------------------------------------------------
    const [riders] = await q.query(
      `SELECT id, name, zone_location_id, is_active
         FROM riders
        ORDER BY created_at ASC`
    );
    const [zones] = await q.query(
      `SELECT id, name FROM locations WHERE type = 'zone' AND is_active = 1 ORDER BY name ASC`
    );

    const claimed = new Set();
    const rows = [];

    // Pass 1 — riders with an explicit zone.
    for (const r of riders) {
      if (!r.zone_location_id) continue;
      if (claimed.has(r.zone_location_id)) continue; // first writer wins
      if (!zones.some((z) => z.id === r.zone_location_id)) continue; // stale FK
      claimed.add(r.zone_location_id);
      rows.push({ captain: r.id, zone: r.zone_location_id });
    }

    // Pass 2 — the first active all-zones rider absorbs the remainder.
    const allZonesRider = riders.find((r) => !r.zone_location_id && r.is_active);
    if (allZonesRider) {
      for (const z of zones) {
        if (claimed.has(z.id)) continue;
        claimed.add(z.id);
        rows.push({ captain: allZonesRider.id, zone: z.id });
      }
    }

    for (const row of rows) {
      await q.query(
        `INSERT INTO captain_zone_assignments
           (id, captain_rider_id, zone_location_id, created_at, updated_at)
         VALUES (UUID(), :captain, :zone, NOW(), NOW())`,
        { replacements: row }
      );
    }

    const uncovered = zones.filter((z) => !claimed.has(z.id));
    /* eslint-disable no-console */
    console.log(
      `[delivery-teams] backfilled ${rows.length} zone assignment(s) across `
      + `${new Set(rows.map((r) => r.captain)).size} captain(s).`
    );
    if (uncovered.length > 0) {
      console.log(
        `[delivery-teams] ${uncovered.length} zone(s) have NO captain and will be `
        + `reported as uncovered until one is assigned: `
        + uncovered.map((z) => z.name).join(', ')
      );
    }
    /* eslint-enable no-console */
  },

  down: async (queryInterface) => {
    const q = queryInterface.sequelize;

    // Order matters, and not in the obvious way. MySQL backs the foreign
    // key on helper_rider_id with the unique index we added, so dropping
    // the index first fails with "needed in a foreign key constraint" and
    // the whole revert stops there. The constraint has to go first, and
    // its name is auto-generated (riders_ibfk_N), so it is looked up
    // rather than guessed.
    const [fks] = await q.query(
      `SELECT CONSTRAINT_NAME AS name
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'riders'
          AND COLUMN_NAME = 'helper_rider_id'
          AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    for (const fk of fks) {
      await q.query(`ALTER TABLE \`riders\` DROP FOREIGN KEY \`${fk.name}\``);
    }

    // Dropping the column takes the index with it, but drop it explicitly
    // first so a partially-applied up (column present, index absent) also
    // reverts cleanly instead of throwing on an index that is not there.
    try {
      await queryInterface.removeIndex('riders', 'uq_riders_helper');
    } catch (_) { /* already gone */ }

    await queryInterface.removeColumn('riders', 'helper_rider_id');
    await queryInterface.dropTable('captain_zone_assignments');
  },
};
