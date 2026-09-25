'use strict';

/**
 * memberDisplay.js — how a record reads once the member behind it is gone.
 *
 * Deleting an account removes the users row and sets `user_id` to NULL on
 * the records that outlive the person: poll responses, donations,
 * feedback (see services/accountDeletionService.js). Every list that
 * eager-loads `{ model: User, as: 'user' }` therefore has to cope with
 * `row.user === null` — and "cope" must mean a readable label, not a
 * blank cell, an `Unknown`, or a crash on `row.user.name`.
 *
 * FORMER_MEMBER_LABEL is deliberately plain. It says the record is real
 * and the person is not here any more; it does not hint at who they were,
 * which is the whole point of the erasure.
 */

const FORMER_MEMBER_LABEL = 'Former member';

/**
 * Normalize an eager-loaded `user` association into a display shape that
 * is always safe to render.
 *
 * @param {object|null} user  the eager-loaded User instance, or null
 * @param {string[]} [fields] which fields the caller's UI actually shows;
 *                            anything not listed is left out so a list
 *                            endpoint doesn't start leaking phone numbers
 *                            just because this helper knows them.
 */
const describeMember = (user, fields = ['id', 'name', 'phone']) => {
  const plain = user && typeof user.get === 'function' ? user.get({ plain: true }) : user;
  const out = { is_former_member: !plain };

  for (const field of fields) {
    if (plain) {
      out[field] = plain[field] ?? null;
    } else {
      out[field] = field === 'name' ? FORMER_MEMBER_LABEL : null;
    }
  }
  return out;
};

module.exports = { describeMember, FORMER_MEMBER_LABEL };
