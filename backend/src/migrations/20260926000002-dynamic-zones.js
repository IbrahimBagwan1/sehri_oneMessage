'use strict';

/**
 * Lets the community have any number of zones, instead of exactly four.
 *
 * THE BUG THIS FIXES (not just a future limitation — it is live today):
 * pollController derived a vote's zone by slugifying the zone's NAME and
 * checking it against a frozen list of four:
 *
 *     const zoneName = zoneLocation.name.toLowerCase().replace(/\s+/g, '_');
 *     if (!VALID_ZONES.includes(zoneName)) reject;
 *
 * Two of the four seeded zones do not survive that round trip:
 *
 *     "Masjid"              -> masjid               in the list   OK
 *     "Boys Hostel"         -> boys_hostel          in the list   OK
 *     "Girls Accommodation" -> girls_accommodation  NOT in it     rejected
 *     "Stanza Living"       -> stanza_living        NOT in it     rejected
 *
 * So a member of Girls Accommodation or Stanza Living cannot cast a vote at
 * all. It has gone unnoticed only because neither zone has members yet.
 *
 * THE FIX is to stop deriving identity from a display name:
 *
 *   locations.zone_key   A stable, unique key assigned to a zone when it is
 *                        created and never changed afterwards. Renaming
 *                        "Boys Hostel" to "Brothers' Hostel" no longer
 *                        orphans a single historical vote.
 *
 *   poll_responses.zone  ENUM -> VARCHAR. It stays a snapshot of the zone key
 *                        at vote time (the whole reason it is denormalised
 *                        onto the response), it just is not limited to four
 *                        values any more. Every count still groups on it, so
 *                        no aggregate changes.
 *
 * The backfill maps the existing zones to the keys ALREADY STORED in
 * poll_responses — masjid, boys_hostel, stanza, girls — rather than to their
 * slugified names, so historical votes keep matching their zone. That is also
 * what repairs Girls Accommodation and Stanza Living: their rows get the keys
 * the enum always expected.
 */

// name -> the key poll_responses has been using since the seed
const LEGACY_KEYS = {
  'Masjid':              'masjid',
  'Boys Hostel':         'boys_hostel',
  'Stanza Living':       'stanza',
  'Girls Accommodation': 'girls',
};

const slugify = (name) =>
  String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'zone';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const q = queryInterface.sequelize;

    await queryInterface.addColumn('locations', 'zone_key', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'Stable identity for a type=zone row; snapshotted onto poll_responses.zone',
    });

    // ---- backfill every existing zone --------------------------------
    const [zones] = await q.query(
      "SELECT id, name FROM locations WHERE type = 'zone'"
    );
    const taken = new Set();
    for (const zone of zones) {
      let key = LEGACY_KEYS[zone.name] || slugify(zone.name);
      let n = 2;
      while (taken.has(key)) key = `${slugify(zone.name)}_${n++}`.slice(0, 50);
      taken.add(key);
      await q.query('UPDATE locations SET zone_key = ? WHERE id = ?', {
        replacements: [key, zone.id],
      });
    }

    // UNIQUE, but nullable — only zones carry a key, and MySQL allows any
    // number of NULLs in a unique index, so every non-zone row is fine.
    await queryInterface.addIndex('locations', ['zone_key'], {
      unique: true,
      name: 'locations_zone_key',
    });

    // ---- widen the snapshot column -----------------------------------
    await q.query(
      'ALTER TABLE `poll_responses` MODIFY COLUMN `zone` VARCHAR(50) '
      + 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;'
    );

    // ---- one default chat group per zone, enforced by the database ----
    // is_default was a bare boolean, so nothing stopped two default groups
    // claiming the same zone. Naming the zone makes the constraint real.
    await queryInterface.addColumn('chat_groups', 'default_zone_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'locations', key: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      comment: 'Set only on the auto-provisioned group for that zone; UNIQUE',
    });
    await q.query(
      'UPDATE `chat_groups` g '
      + 'JOIN `chat_group_zones` gz ON gz.group_id = g.id '
      + 'SET g.default_zone_id = gz.zone_location_id '
      + 'WHERE g.is_default = 1;'
    );
    await queryInterface.addIndex('chat_groups', ['default_zone_id'], {
      unique: true,
      name: 'chat_groups_default_zone_id',
    });
  },

  down: async (queryInterface) => {
    const q = queryInterface.sequelize;

    await queryInterface.removeIndex('chat_groups', 'chat_groups_default_zone_id');
    await queryInterface.removeColumn('chat_groups', 'default_zone_id');

    // Rolling back narrows the column again, so anything outside the original
    // four values would be silently truncated. Dev-environment only.
    await q.query(
      "ALTER TABLE `poll_responses` MODIFY COLUMN `zone` "
      + "ENUM('masjid','boys_hostel','stanza','girls') "
      + 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;'
    );

    await queryInterface.removeIndex('locations', 'locations_zone_key');
    await queryInterface.removeColumn('locations', 'zone_key');
  },
};
