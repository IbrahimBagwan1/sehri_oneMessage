'use strict';

const jwt = require('jsonwebtoken');

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

// Pinned so a token can never be accepted under a different algorithm than
// the one it was issued with.
const ALGORITHM = 'HS256';

/**
 * Access token payload: { id, role, sid, zone_location_id?, user_id? }
 * plus typ:'access'. role is 'user' | 'admin' | 'super_admin' | 'rider'.
 *
 * `typ` exists because three different kinds of token are signed with
 * JWT_SECRET-family keys in this codebase (access tokens, refresh tokens,
 * and the phone-verification ticket in otpController). Without it, any of
 * them that happened to verify would be treated as an access token.
 */
const signAccessToken = (payload) =>
  jwt.sign({ ...payload, typ: 'access' }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN,
    algorithm: ALGORITHM,
  });

/**
 * Refresh token payload is deliberately minimal: { sid, jti, typ }. Every
 * claim that describes the account is re-read from the database when the
 * token is exchanged — see services/authSessionService.js — so a refresh
 * can never resurrect a role, a zone, or an account that has since changed.
 */
const signRefreshToken = ({ sid, jti }) =>
  jwt.sign({ sid, jti, typ: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
    algorithm: ALGORITHM,
  });

const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALGORITHM] });
  // Reject anything that is not an access token: a phone-verification
  // ticket carries `kind`, a refresh token carries typ:'refresh', and
  // neither has a role to authorise against.
  if (decoded.kind || (decoded.typ && decoded.typ !== 'access') || !decoded.role || !decoded.id) {
    throw new jwt.JsonWebTokenError('not an access token');
  }
  return decoded;
};

const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: [ALGORITHM] });
  if (decoded.typ !== 'refresh' || !decoded.sid || !decoded.jti) {
    throw new jwt.JsonWebTokenError('not a session refresh token');
  }
  return decoded;
};

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  ACCESS_EXPIRES_IN,
  REFRESH_EXPIRES_IN,
};
