'use strict';

/**
 * Three things the release audit found the schema could not express.
 *
 * 1. auth_sessions — refresh tokens you can take back.
 *    A refresh token used to be a self-contained 30-day JWT that the server
 *    re-signed on every refresh without looking anything up. So nothing
 *    could end a session: not signing out, not a password reset, not
 *    deleting the account, not removing someone's admin role. Each row here
 *    is one signed-in device. The refresh token names its row (`sid`) and the
 *    one refresh-token id currently valid for it (`current_jti`); rotating
 *    replaces that id, and presenting an old one — the signature of a stolen
 *    token being replayed — ends the session outright.
 *
 * 2. login_throttles — a lockout keyed by phone number.
 *    OTP sends were rate limited; password sign-in was not limited at all.
 *    An IP limit alone does not stop a distributed guess against one number,
 *    so failures are counted per phone, in the database, where every server
 *    instance and every restart sees the same count.
 *
 * 3. polls.is_active becomes three-state (NULL = follow the schedule).
 *    See utils/pollPhase.js. Polls dated today or later are reset to NULL:
 *    their current TRUE/FALSE was written by poll creation, not by a person
 *    deciding to override anything, and it is what kept voting open all day.
 */

const {
  createTableIfMissing,
  addIndexIfMissing,
  tableExists,
} = require('../utils/migrationHelpers');

// Every step is idempotent (see utils/migrationHelpers.js): if a deploy
// fails part way, running the migration again completes it.
const todayIST = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // -----------------------------------------------------------------
    // 1. auth_sessions
    // -----------------------------------------------------------------
    await createTableIfMissing(queryInterface, 'auth_sessions', {
      id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
      subject_type: {
        type: Sequelize.ENUM('user', 'admin', 'super_admin', 'rider'),
        allowNull: false,
      },
      subject_id: { type: Sequelize.UUID, allowNull: false },
      current_jti: { type: Sequelize.STRING(64), allowNull: false },
      previous_jti: { type: Sequelize.STRING(64), allowNull: true },
      rotated_at: { type: Sequelize.DATE, allowNull: true },
      last_used_at: { type: Sequelize.DATE, allowNull: true },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      revoked_reason: { type: Sequelize.STRING(40), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    // "End every session this account has" — sign-out-everywhere, deletion,
    // role removal, password reset.
    await addIndexIfMissing(queryInterface, 'auth_sessions', ['subject_type', 'subject_id'], {
      name: 'idx_auth_sessions_subject',
    });
    // Housekeeping sweep of expired rows.
    await addIndexIfMissing(queryInterface, 'auth_sessions', ['expires_at'], {
      name: 'idx_auth_sessions_expires',
    });

    // -----------------------------------------------------------------
    // 2. login_throttles
    // -----------------------------------------------------------------
    await createTableIfMissing(queryInterface, 'login_throttles', {
      phone: { type: Sequelize.STRING(15), primaryKey: true, allowNull: false },
      failures: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      window_started_at: { type: Sequelize.DATE, allowNull: true },
      lockouts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      locked_until: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // -----------------------------------------------------------------
    // 3. polls.is_active → three-state
    // -----------------------------------------------------------------
    await queryInterface.changeColumn('polls', 'is_active', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.sequelize.query(
      'UPDATE polls SET is_active = NULL WHERE date >= :today',
      { replacements: { today: todayIST() } }
    );
  },

  down: async (queryInterface, Sequelize) => {
    // NULL has no two-state equivalent; FALSE is the old model's
    // "not manually opened", which is the closest meaning.
    await queryInterface.sequelize.query('UPDATE polls SET is_active = 0 WHERE is_active IS NULL');
    await queryInterface.changeColumn('polls', 'is_active', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    });
    if (await tableExists(queryInterface, 'login_throttles')) await queryInterface.dropTable('login_throttles');
    if (await tableExists(queryInterface, 'auth_sessions')) await queryInterface.dropTable('auth_sessions');
  },
};
