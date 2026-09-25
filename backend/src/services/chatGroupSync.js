'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const logger = require('../utils/logger');

const {
  Location, User, Admin, SuperAdmin,
  ChatGroup, ChatGroupMember, ChatGroupZone,
} = db;

/**
 * chatGroupSync.js — keeps zone chat groups honest.
 *
 * THE RULE, in one sentence: a group's membership is whatever its zone links
 * say it should be, plus whoever a super admin added by hand.
 *
 * Everything here is written as RECONCILIATION rather than as a set of
 * incremental hooks. Given a group, we compute who *ought* to be in it right
 * now and diff that against who *is*, then add and remove the difference.
 * That is deliberately more work than "on approve, insert a row", and it buys
 * the property that matters in production: it is idempotent and
 * self-healing. A hook that fails, a row inserted straight into the database,
 * a zone reassigned by a migration — none of it can leave the chat
 * permanently wrong, because the next reconcile fixes it. The app runs one on
 * boot for exactly that reason.
 *
 * WHO IS ENTITLED to a group, given the zones it covers:
 *   • every APPROVED user whose location resolves up to one of those zones
 *   • every ACTIVE admin assigned to one of those zones
 *   • every ACTIVE super admin, in every zone-backed group
 *
 * Those three are the "compulsory" members — the reconciler adds them, marks
 * them source='auto', and the remove-member endpoint refuses to take them
 * out. Manual members are never touched here.
 *
 * A note on identity: chat membership is polymorphic — (user_id, user_type)
 * where user_type picks the table. A person who is both a member and a zone
 * admin therefore holds TWO chat identities and legitimately appears twice;
 * getActor() in chatController resolves whichever role their token is
 * currently using. That is why the keys below are `type:id`, not bare ids.
 */

/** Stable key for a polymorphic chat identity. */
const key = (type, id) => `${type}:${id}`;

/**
 * Map every location id to the zone it belongs to.
 *
 * The locations table is a small self-referencing tree (city → region → area
 * → zone → address), so we load it once and walk it in memory rather than
 * issuing a query per user. A zone maps to itself, which is what makes a user
 * registered directly against a zone work.
 */
const buildZoneIndex = async () => {
  const rows = await Location.findAll({ attributes: ['id', 'type', 'parent_id'] });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const zoneOf = new Map();

  for (const row of rows) {
    const seen = [];
    let cur = row;
    let hops = 0;
    // Walk up until we hit a zone, run out of parents, or trip the cycle
    // guard. MAX_HOPS mirrors utils/resolveZone.js.
    while (cur && cur.type !== 'zone' && hops < 10) {
      seen.push(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      hops += 1;
    }
    const zoneId = cur && cur.type === 'zone' ? cur.id : null;
    zoneOf.set(row.id, zoneId);
    // Memoise the whole path we just walked — every location on it shares
    // this zone, so a deep tree still costs one pass overall.
    for (const id of seen) zoneOf.set(id, zoneId);
  }
  return zoneOf;
};

/**
 * The set of chat identities entitled to a group covering `zoneIds`.
 * Returns a Map of `type:id` → { user_id, user_type }.
 */
const entitledMembers = async (zoneIds, zoneIndex) => {
  const wanted = new Map();
  if (zoneIds.length === 0) return wanted;

  const zoneSet = new Set(zoneIds);

  const [users, admins, superAdmins] = await Promise.all([
    // Only approved members. Someone still pending, or rejected, has no
    // business reading the zone's conversation.
    User.findAll({ where: { status: 'approved' }, attributes: ['id', 'location_id'] }),
    Admin.findAll({
      where: { is_active: true, zone_location_id: { [Op.in]: zoneIds } },
      attributes: ['id'],
    }),
    // Super admins belong in every zone-backed group by definition.
    SuperAdmin.findAll({ where: { is_active: true }, attributes: ['id'] }),
  ]);

  for (const u of users) {
    const zoneId = zoneIndex.get(u.location_id);
    if (zoneId && zoneSet.has(zoneId)) wanted.set(key('user', u.id), { user_id: u.id, user_type: 'user' });
  }
  for (const a of admins) wanted.set(key('admin', a.id), { user_id: a.id, user_type: 'admin' });
  for (const sa of superAdmins) wanted.set(key('super_admin', sa.id), { user_id: sa.id, user_type: 'super_admin' });

  return wanted;
};

/**
 * Reconcile one group's automatic membership.
 *
 * @returns {{ added: number, removed: number, promoted: number }}
 */
const reconcileGroup = async (group, zoneIndex) => {
  const links = await ChatGroupZone.findAll({
    where: { group_id: group.id },
    attributes: ['zone_location_id'],
  });
  const zoneIds = links.map((l) => l.zone_location_id);

  // A group with no zone links is a purely manual group — leave it entirely
  // alone rather than emptying it.
  if (zoneIds.length === 0) return { added: 0, removed: 0, promoted: 0 };

  const index = zoneIndex || (await buildZoneIndex());
  const wanted = await entitledMembers(zoneIds, index);

  const existing = await ChatGroupMember.findAll({ where: { group_id: group.id } });
  const existingByKey = new Map(existing.map((m) => [key(m.user_type, m.user_id), m]));

  // ADD anyone entitled who isn't in the room yet.
  const toInsert = [];
  let promoted = 0;
  for (const [k, who] of wanted) {
    const row = existingByKey.get(k);
    if (!row) {
      toInsert.push({ group_id: group.id, ...who, source: 'auto' });
    } else if (row.source !== 'auto') {
      // Someone added by hand who now qualifies on their own. Entitlement
      // wins: they become compulsory, so the remove endpoint stops letting
      // them be taken out of a room they belong in.
      await row.update({ source: 'auto' });
      promoted += 1;
    }
  }
  if (toInsert.length) {
    await ChatGroupMember.bulkCreate(toInsert, { ignoreDuplicates: true });
  }

  // REMOVE auto members who are no longer entitled — left the zone, lost
  // their admin role, were deactivated. Manual members are not ours to touch.
  const staleIds = existing
    .filter((m) => m.source === 'auto' && !wanted.has(key(m.user_type, m.user_id)))
    .map((m) => m.id);
  if (staleIds.length) {
    await ChatGroupMember.destroy({ where: { id: { [Op.in]: staleIds } } });
  }

  return { added: toInsert.length, removed: staleIds.length, promoted };
};

/**
 * Create the default chat group for any active zone that hasn't got one.
 *
 * Matched on the zone LINK rather than the name, so renaming a group does not
 * cause a duplicate to appear next boot.
 */
const ensureZoneGroups = async () => {
  const zones = await Location.findAll({
    where: { type: 'zone', is_active: true },
    attributes: ['id', 'name'],
    order: [['name', 'ASC']],
  });
  if (zones.length === 0) return [];

  const defaults = await ChatGroup.findAll({
    where: { is_default: true },
    attributes: ['id'],
    include: [{ model: ChatGroupZone, as: 'zones', attributes: ['zone_location_id'] }],
  });
  const covered = new Set(
    defaults.flatMap((g) => (g.zones || []).map((z) => z.zone_location_id))
  );

  // The group has to record a creator, and this runs with no request behind
  // it. The longest-standing active super admin stands in as the owner.
  const owner = await SuperAdmin.findOne({
    where: { is_active: true },
    order: [['created_at', 'ASC']],
    attributes: ['id'],
  });
  if (!owner) {
    logger.warn('[chatSync] No active super admin — skipping zone group provisioning');
    return [];
  }

  const created = [];
  for (const zone of zones) {
    if (covered.has(zone.id)) continue;
    const group = await ChatGroup.create({
      name: zone.name,
      description: `Everyone in ${zone.name} — members, zone admins and super admins.`,
      created_by: owner.id,
      is_active: true,
      is_default: true,
    });
    await ChatGroupZone.create({ group_id: group.id, zone_location_id: zone.id });
    created.push(group);
    logger.info(`[chatSync] Created default chat group for zone "${zone.name}" (${group.id})`);
  }
  return created;
};

/** Reconcile every active zone-backed group. One zone index for the lot. */
const reconcileAllGroups = async () => {
  const groups = await ChatGroup.findAll({ where: { is_active: true }, attributes: ['id'] });
  if (groups.length === 0) return { groups: 0, added: 0, removed: 0 };

  const zoneIndex = await buildZoneIndex();
  let added = 0;
  let removed = 0;
  for (const group of groups) {
    const r = await reconcileGroup(group, zoneIndex);
    added += r.added;
    removed += r.removed;
  }
  return { groups: groups.length, added, removed };
};

/**
 * Reconcile only the groups covering the given zones.
 *
 * This is the hook the rest of the app calls after something that changes
 * entitlement — a member approved, a profile's location edited, an admin
 * promoted or removed.
 *
 * `zoneIds` may contain nulls and duplicates; callers usually do not know
 * which zone someone came from. Passing none reconciles everything, which is
 * the right fallback for a change whose blast radius isn't known.
 */
const syncZones = async (zoneIds = []) => {
  const ids = [...new Set(zoneIds.filter(Boolean))];
  if (ids.length === 0) return reconcileAllGroups();

  const links = await ChatGroupZone.findAll({
    where: { zone_location_id: { [Op.in]: ids } },
    attributes: ['group_id'],
  });
  const groupIds = [...new Set(links.map((l) => l.group_id))];
  if (groupIds.length === 0) return { groups: 0, added: 0, removed: 0 };

  const groups = await ChatGroup.findAll({
    where: { id: { [Op.in]: groupIds }, is_active: true },
    attributes: ['id'],
  });
  const zoneIndex = await buildZoneIndex();
  let added = 0;
  let removed = 0;
  for (const group of groups) {
    const r = await reconcileGroup(group, zoneIndex);
    added += r.added;
    removed += r.removed;
  }
  return { groups: groups.length, added, removed };
};

/** The zone a user currently resolves to, or null. */
const zoneForLocation = async (locationId) => {
  if (!locationId) return null;
  const index = await buildZoneIndex();
  return index.get(locationId) || null;
};

/**
 * Fire-and-forget wrapper for controller call sites.
 *
 * Chat membership must never be the reason an approval or a promotion fails,
 * so this swallows and logs. The boot-time reconcile is the backstop: if this
 * throws, the group is wrong until the next restart or the next change in
 * that zone, not wrong forever.
 */
const syncInBackground = (zoneIds, context) => {
  syncZones(zoneIds).catch((err) => {
    logger.error(`[chatSync] ${context} reconcile failed: ${err.name}: ${err.message}`);
  });
};

/** Boot-time entry point: provision missing zone groups, then reconcile all. */
const bootstrap = async () => {
  const created = await ensureZoneGroups();
  const result = await reconcileAllGroups();
  logger.info(
    `[chatSync] Ready — ${created.length} zone group(s) created, ` +
    `${result.groups} group(s) reconciled (+${result.added} / -${result.removed} auto members)`
  );
  return result;
};

module.exports = {
  bootstrap,
  ensureZoneGroups,
  reconcileGroup,
  reconcileAllGroups,
  syncZones,
  syncInBackground,
  zoneForLocation,
  buildZoneIndex,
};
