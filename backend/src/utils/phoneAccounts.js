'use strict';

const db = require('../models');

const { User, Admin, SuperAdmin, Rider } = db;

/**
 * phoneAccounts.js — "is this phone number already taken?" in one place.
 *
 * Phone is UNIQUE in all four account tables (users, admins,
 * super_admins, riders) and authController.loginUser resolves a sign-in
 * by looking the phone up across all of them. So "taken" genuinely means
 * taken in ANY of them, not just `users` — if a row exists anywhere, that
 * number can already sign in, and a second registration under it would
 * create a confusing split identity (a users row whose password is
 * ignored, because login authenticates against the highest role found).
 *
 * The self-service path for a privileged account that also wants a user
 * identity is POST /api/admin/link-user-account, which reuses their
 * existing password instead of creating a divergent one.
 *
 * Deliberately queried by phone rather than by the user_id links, because
 * a standalone admin/rider created without a linked users row still owns
 * that phone number for sign-in purposes.
 */

/** Machine-readable code the frontend branches on. */
const PHONE_TAKEN_CODE = 'PHONE_ALREADY_REGISTERED';

/**
 * Look the phone up across every account table.
 *
 * @returns {Promise<{
 *   user: object|null,
 *   admin: object|null,
 *   superAdmin: object|null,
 *   rider: object|null,
 *   exists: boolean,
 *   roles: string[],
 * }>}
 */
const findAccountsForPhone = async (phone) => {
  const [user, admin, superAdmin, rider] = await Promise.all([
    User.findOne({ where: { phone }, attributes: ['id', 'status'] }),
    Admin.findOne({ where: { phone }, attributes: ['id'] }),
    SuperAdmin.findOne({ where: { phone }, attributes: ['id'] }),
    Rider.findOne({ where: { phone }, attributes: ['id'] }),
  ]);

  const roles = [];
  if (user)       roles.push('user');
  if (admin)      roles.push('admin');
  if (superAdmin) roles.push('super_admin');
  if (rider)      roles.push('rider');

  return {
    user,
    admin,
    superAdmin,
    rider,
    exists: roles.length > 0,
    roles,
  };
};

/**
 * Plain-language reason a phone can't be registered, tailored to which
 * kind of account already holds it. Returns null when the number is free.
 *
 * A soft-deleted user (status='deleted') still occupies the phone —
 * userController's delete flow anonymizes the row but keeps it for
 * community records, and the unique index still applies. We say so
 * explicitly rather than showing "log in instead" for an account that
 * can no longer sign in.
 */
const describePhoneConflict = (accounts) => {
  if (!accounts.exists) return null;

  if (accounts.user) {
    if (accounts.user.status === 'deleted') {
      return 'This number was used by an account that has since been deleted. '
           + 'Contact an admin to have it freed up.';
    }
    return 'An account with this number already exists. Log in instead.';
  }

  // No users row, but an admin / super admin / rider owns the number.
  // Signing in with it already works; they can add a user identity from
  // their own dashboard rather than registering a second time.
  return 'This number is already registered to a staff account. '
       + 'Sign in with it instead — you can add a member profile from your dashboard.';
};

module.exports = {
  PHONE_TAKEN_CODE,
  findAccountsForPhone,
  describePhoneConflict,
};
