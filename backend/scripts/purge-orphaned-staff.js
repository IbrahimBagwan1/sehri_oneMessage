'use strict';

/**
 * purge-orphaned-staff.js
 *
 * One-off cleanup for phone numbers stranded by the OLD account-delete
 * flow (replaced by src/services/accountDeletionService.js).
 *
 * That flow anonymized the `users` row but left the person's
 * admin / super_admin / rider row in place with its REAL PHONE, merely
 * unlinked (`user_id = NULL`) and deactivated (`is_active = 0`). Those
 * rows are why a deleted member was told "This account has been
 * deactivated" at sign-in and "already registered" at sign-up: both
 * checks look across all four account tables by phone.
 *
 * The migration (20260925000002) purges the anonymized `users` rows, but
 * deliberately does NOT touch staff rows — from the data alone, a
 * deletion leftover and a super admin who was legitimately suspended are
 * indistinguishable. That call needs a human, which is what this script
 * is for.
 *
 *   node scripts/purge-orphaned-staff.js              # dry run, lists candidates
 *   node scripts/purge-orphaned-staff.js --apply      # delete them
 *   node scripts/purge-orphaned-staff.js --apply --phone=9632716392,9812340002
 *
 * A candidate is any admin / super_admin / rider row that is BOTH
 * unlinked and inactive. Each one is printed with the context needed to
 * judge it — most importantly whether a live member still holds that
 * number (if so, the row is almost certainly a leftover from a delete
 * followed by a fresh registration).
 *
 * Refuses to remove the last active super admin, same as the runtime
 * delete flow.
 */

require('dotenv').config();
const { Op } = require('sequelize');
const db = require('../src/models');

const { Admin, SuperAdmin, Rider, User, Poll } = db;

const TABLES = [
  { label: 'admin',       model: Admin },
  { label: 'super_admin', model: SuperAdmin },
  { label: 'rider',       model: Rider },
];

const apply = process.argv.includes('--apply');
const phoneArg = process.argv.find((a) => a.startsWith('--phone='));
const phoneFilter = phoneArg
  ? phoneArg.slice('--phone='.length).split(',').map((p) => p.trim()).filter(Boolean)
  : null;

(async () => {
  try {
    await db.sequelize.authenticate();

    const where = { user_id: null, is_active: false };
    if (phoneFilter) where.phone = { [Op.in]: phoneFilter };

    const candidates = [];
    for (const { label, model } of TABLES) {
      const rows = await model.findAll({ where, order: [['created_at', 'ASC']] });
      for (const row of rows) candidates.push({ label, model, row });
    }

    if (candidates.length === 0) {
      process.stdout.write('No orphaned staff rows found. Nothing to do.\n');
      await db.sequelize.close();
      return;
    }

    process.stdout.write(
      `${candidates.length} unlinked + inactive staff row(s) found` +
      `${phoneFilter ? ` (filtered to ${phoneFilter.join(', ')})` : ''}:\n\n`
    );

    for (const c of candidates) {
      const liveUser = await User.findOne({
        where: { phone: c.row.phone },
        attributes: ['id', 'name', 'status'],
      });
      process.stdout.write(
        `  ${c.label.padEnd(12)} ${String(c.row.phone).padEnd(14)} ` +
        `${String(c.row.name).padEnd(22)} created ${new Date(c.row.createdAt).toISOString().slice(0, 10)}\n` +
        `  ${' '.repeat(12)} ${liveUser
          ? `→ a live member (${liveUser.name}, ${liveUser.status}) already holds this number`
          : '→ no member holds this number; it is currently unusable for registration'}\n\n`
      );
    }

    if (!apply) {
      process.stdout.write('Dry run — nothing was changed. Re-run with --apply to delete these rows.\n');
      await db.sequelize.close();
      return;
    }

    // Same guard as the runtime flow: never strand the community without
    // an administrator.
    const doomedSuperAdminIds = candidates
      .filter((c) => c.label === 'super_admin')
      .map((c) => c.row.id);
    if (doomedSuperAdminIds.length > 0) {
      const survivors = await SuperAdmin.count({
        where: { id: { [Op.notIn]: doomedSuperAdminIds }, is_active: true },
      });
      if (survivors === 0) {
        process.stderr.write(
          'Refusing to run: this would remove every remaining super admin.\n'
        );
        process.exitCode = 1;
        await db.sequelize.close();
        return;
      }
    }

    const t = await db.sequelize.transaction();
    try {
      for (const c of candidates) {
        if (c.label === 'rider') {
          await Poll.update(
            { assigned_rider_id: null },
            { where: { assigned_rider_id: c.row.id }, transaction: t }
          );
        }
        await c.row.destroy({ transaction: t });
      }
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    process.stdout.write(`Removed ${candidates.length} orphaned staff row(s).\n`);
    await db.sequelize.close();
  } catch (err) {
    process.stderr.write(`purge-orphaned-staff failed: ${err.name}: ${err.message}\n`);
    process.exitCode = 1;
    try { await db.sequelize.close(); } catch (_) { /* noop */ }
  }
})();
