'use strict';

/**
 * authSessionService.js — sessions that can end.
 *
 * MODEL
 * Signing in creates one auth_sessions row: one device, one account, one
 * role. The client receives
 *   • an access token  — short-lived (15 min), carries the claims, checked
 *                        by signature alone on every request;
 *   • a refresh token  — names the session (`sid`) and the one token id
 *                        (`jti`) currently valid for it, nothing else.
 *
 * ROTATION + REUSE DETECTION
 * Every refresh issues a new jti and retires the old one. A retired jti
 * being presented again means two parties hold the same refresh token — the
 * signature of a token copied off a device — and the session is revoked on
 * the spot, logging out both the thief and the owner, who signs back in.
 *
 * One exception: the retired jti within a few seconds of rotation. The
 * rider app refreshes from two JavaScript contexts (the screen and the
 * background location task), and both can wake on the same expired token.
 * The loser of that race gets 401 REFRESH_SUPERSEDED — not a revocation —
 * and re-reads the token the winner already stored.
 *
 * CLAIMS ARE RE-READ ON EVERY REFRESH
 * The old refresh re-signed whatever the old token said. A removed admin, a
 * deactivated rider, a member who deleted their account, an admin moved to
 * another zone: all of them kept their old powers for as long as they kept
 * refreshing. Now the account is looked up each time, and an account that no
 * longer qualifies ends its session.
 *
 * WHAT IS NOT CHECKED
 * Access tokens are not looked up per request. A revoked session's current
 * access token keeps working until it expires — at most
 * JWT_ACCESS_EXPIRES_IN, which env.js keeps at an hour or less in
 * production. That is the standard trade for not putting a database read on
 * every API call.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../models');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { durationSeconds } = require('../config/env');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require('../utils/jwt');

const { AuthSession, User, Admin, SuperAdmin, Rider } = db;

const SUPERSEDED_GRACE_MS = 30 * 1000;

const refreshTtlMs = () =>
  (durationSeconds(process.env.JWT_REFRESH_EXPIRES_IN || '30d') || 30 * 86400) * 1000;

const MODEL_FOR = {
  user: User,
  admin: Admin,
  super_admin: SuperAdmin,
  rider: Rider,
};

/**
 * The access-token claims for an account in a role.
 *
 * user_id rides along on staff tokens when the account has a linked users
 * row, so an admin can use member features without a second sign-in.
 * zone_location_id is the admin's zone (required) or the rider's (optional).
 */
const buildClaims = (role, account) => {
  const claims = { id: account.id, role };
  if ((role === 'admin' || role === 'rider') && account.zone_location_id) {
    claims.zone_location_id = account.zone_location_id;
  }
  if (role !== 'user' && account.user_id) claims.user_id = account.user_id;
  return claims;
};

/**
 * Why an account can no longer hold a session, or null when it still can.
 * Mirrors the gates the sign-in endpoints apply.
 */
const unusableReason = (role, account) => {
  if (!account) return 'account_gone';
  if (role === 'user') return account.status === 'approved' ? null : 'not_approved';
  return account.is_active === false ? 'deactivated' : null;
};

const newJti = () => crypto.randomBytes(24).toString('base64url');

const mintPair = (role, account, session) => ({
  accessToken: signAccessToken({ ...buildClaims(role, account), sid: session.id }),
  refreshToken: signRefreshToken({ sid: session.id, jti: session.current_jti }),
});

/**
 * Start a session for an account that has just proved who it is.
 * @returns {Promise<{ accessToken, refreshToken, sessionId }>}
 */
const issueSession = async (role, account, { transaction } = {}) => {
  if (!MODEL_FOR[role]) throw new Error(`issueSession: unknown role ${role}`);
  const now = new Date();
  const session = await AuthSession.create({
    id: crypto.randomUUID(),
    subject_type: role,
    subject_id: account.id,
    current_jti: newJti(),
    last_used_at: now,
    expires_at: new Date(now.getTime() + refreshTtlMs()),
  }, { transaction });
  return { ...mintPair(role, account, session), sessionId: session.id };
};

/**
 * Exchange a refresh token for a new pair.
 *
 * @returns {Promise<{ accessToken, refreshToken, role, account }>}
 * @throws  {AppError} 401 with a code the client can branch on
 */
const rotateSession = async (refreshToken) => {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Your session has expired. Please sign in again.', 401, 'REFRESH_INVALID');
  }

  const t = await db.sequelize.transaction();
  try {
    const session = await AuthSession.findByPk(decoded.sid, { transaction: t, lock: t.LOCK.UPDATE });
    const now = new Date();

    if (!session || session.revoked_at || session.expires_at <= now) {
      await t.rollback();
      throw new AppError('Your session has ended. Please sign in again.', 401, 'SESSION_ENDED');
    }

    if (decoded.jti !== session.current_jti) {
      const recentlyRotated = decoded.jti === session.previous_jti
        && session.rotated_at
        && now - session.rotated_at < SUPERSEDED_GRACE_MS;
      if (recentlyRotated) {
        await t.rollback();
        throw new AppError('This session was just refreshed elsewhere on this device.', 401, 'REFRESH_SUPERSEDED');
      }
      // A retired token came back after the grace window: someone else has
      // it. End the session for everyone holding it.
      await session.update({ revoked_at: now, revoked_reason: 'reuse_detected' }, { transaction: t });
      await t.commit();
      logger.warn(`[auth] refresh token reuse detected — session ${session.id} (${session.subject_type}) revoked`);
      throw new AppError('Your session has ended. Please sign in again.', 401, 'SESSION_ENDED');
    }

    const role = session.subject_type;
    const account = await MODEL_FOR[role].findByPk(session.subject_id, { transaction: t });
    const reason = unusableReason(role, account);
    if (reason) {
      await session.update({ revoked_at: now, revoked_reason: reason }, { transaction: t });
      await t.commit();
      throw new AppError('This account can no longer sign in. Contact an admin if this is unexpected.', 401, 'ACCOUNT_UNAVAILABLE');
    }

    await session.update({
      previous_jti: session.current_jti,
      current_jti: newJti(),
      rotated_at: now,
      last_used_at: now,
      expires_at: new Date(now.getTime() + refreshTtlMs()),
    }, { transaction: t });
    await t.commit();

    return { ...mintPair(role, account, session), role, account };
  } catch (err) {
    if (!t.finished) {
      try { await t.rollback(); } catch (_) { /* already released */ }
    }
    throw err;
  }
};

/** End one session. Idempotent. */
const revokeSession = async (sessionId, reason = 'signed_out') => {
  if (!sessionId) return 0;
  const [n] = await AuthSession.update(
    { revoked_at: new Date(), revoked_reason: reason },
    { where: { id: sessionId, revoked_at: null } }
  );
  return n;
};

/** End the session a refresh token belongs to (sign-out). Never throws. */
const revokeByRefreshToken = async (refreshToken, reason = 'signed_out') => {
  try {
    const { sid } = verifyRefreshToken(refreshToken);
    return await revokeSession(sid, reason);
  } catch {
    // An expired or malformed token has no live session to end — signing
    // out with it is already achieved.
    return 0;
  }
};

/**
 * End every session held by the given accounts.
 * @param {Array<{ type: string, id: string }>} subjects
 */
const revokeSubjects = async (subjects, reason, { transaction } = {}) => {
  const valid = (subjects || []).filter((s) => s && s.id && MODEL_FOR[s.type]);
  if (valid.length === 0) return 0;
  const [n] = await AuthSession.update(
    { revoked_at: new Date(), revoked_reason: reason },
    {
      where: {
        revoked_at: null,
        [Op.or]: valid.map((s) => ({ subject_type: s.type, subject_id: s.id })),
      },
      transaction,
    }
  );
  if (n) logger.info(`[auth] revoked ${n} session(s): ${reason}`);
  return n;
};

/** Every account that signs in with this phone number, in every role. */
const subjectsForPhone = async (phone, { transaction } = {}) => {
  const rows = await Promise.all(
    Object.entries(MODEL_FOR).map(async ([type, Model]) => {
      const found = await Model.findAll({ where: { phone }, attributes: ['id'], transaction });
      return found.map((r) => ({ type, id: r.id }));
    })
  );
  return rows.flat();
};

/**
 * Housekeeping: drop sessions that ended more than a week ago. Harmless to
 * run on every instance at once — it is a single idempotent DELETE.
 */
const purgeStaleSessions = async () => {
  const cutoff = new Date(Date.now() - 7 * 86400 * 1000);
  const n = await AuthSession.destroy({
    where: {
      [Op.or]: [
        { expires_at: { [Op.lt]: cutoff } },
        { revoked_at: { [Op.lt]: cutoff } },
      ],
    },
  });
  if (n) logger.info(`[auth] purged ${n} stale session row(s)`);
  return n;
};

module.exports = {
  buildClaims,
  issueSession,
  rotateSession,
  revokeSession,
  revokeByRefreshToken,
  revokeSubjects,
  subjectsForPhone,
  purgeStaleSessions,
  unusableReason,
};
