'use strict';
const bcrypt = require('bcryptjs');
const db = require('../models');
const otpService = require('../services/otpService');
const { verifyVerificationTicket } = require('./otpController');
const {
  PHONE_TAKEN_CODE,
  findAccountsForPhone,
  describePhoneConflict,
} = require('../utils/phoneAccounts');
const { success, error } = require('../utils/response');
const authSessionService = require('../services/authSessionService');
const loginThrottle = require('../services/loginThrottleService');
const reviewDemo = require('../services/reviewDemoService');
const chatGroupSync = require('../services/chatGroupSync');
const logger = require('../utils/logger');
const { User, Location, Admin, SuperAdmin, Rider } = db;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * "No account at all" is a genuinely different answer from "wrong
 * password" and from "your account is suspended", and the three used to
 * be muddled — a deleted member was told their account was *deactivated*,
 * which is both wrong and a dead end (there is nothing to reactivate).
 *
 * Keeping them distinct is safe here: registration already tells an
 * unknown caller whether a number is taken ("An account with this number
 * already exists. Log in instead."), so the login side leaks nothing new,
 * and the person who just deleted their account gets the one instruction
 * that actually helps them.
 *
 * NO_ACCOUNT_CODE lets the client offer "Create an account" inline
 * instead of string-matching the copy.
 */
const NO_ACCOUNT_CODE = 'NO_ACCOUNT_FOUND';
const NO_ACCOUNT_MESSAGE =
  'No account found for this number. Create a new account to get started.';

/**
 * Given a phone number, checks all three tables and returns every role
 * that phone number holds, along with the account record for each.
 *
 * Returns: { superAdminAccount, adminAccount, userAccount, riderAccount }
 * Any of these may be null if the phone doesn't exist in that table.
 * riderAccount is found via user_id link — same phone, rider table.
 */
const findAllRolesForPhone = async (phone) => {
  const [superAdminAccount, adminAccount, userAccount] = await Promise.all([
    SuperAdmin.scope('withPassword').findOne({ where: { phone } }),
    Admin.scope('withPassword').findOne({ where: { phone } }),
    User.scope('withPassword').findOne({ where: { phone } }),
  ]);

  // Rider accounts are linked via user_id, not phone directly.
  // Look up rider only if a user account exists.
  let riderAccount = null;
  if (userAccount) {
    riderAccount = await Rider.scope('withPassword').findOne({
      where: { user_id: userAccount.id, is_active: true },
    });
  }

  return { superAdminAccount, adminAccount, userAccount, riderAccount };
};

/**
 * Derives the list of role strings held by a phone number.
 * Used to populate available_roles in the login response.
 *
 * A suspended role is left out: switchRole would reject it anyway, so
 * advertising it only puts a chip on the dashboard that errors when
 * tapped. (riderAccount is already looked up with is_active: true.)
 */
const isUsable = (account) => !!account && account.is_active !== false;

const deriveAvailableRoles = ({ superAdminAccount, adminAccount, userAccount, riderAccount }) => {
  const roles = [];
  if (isUsable(userAccount)) roles.push('user');
  if (isUsable(adminAccount)) roles.push('admin');
  if (isUsable(superAdminAccount)) roles.push('super_admin');
  if (riderAccount) roles.push('rider');
  return roles;
};

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------
const registerUser = async (req, res, next) => {
  try {
    const {
      name,
      phone,
      password,
      gender,
      occupation,
      city,
      location_id,
      address,
      otp,
      verification_token: verificationToken,
    } = req.body;

    // Phone ownership is proved by EITHER a verification ticket from the
    // dedicated verify-OTP screen, OR a raw OTP from the legacy
    // single-screen flow. The ticket path exists because verifying an
    // OTP consumes it — see otpController.signVerificationTicket.
    if (verificationToken) {
      const ticket = verifyVerificationTicket(verificationToken, phone, 'registration');
      if (!ticket) {
        return error(res, {
          statusCode: 400,
          message: 'Your phone verification expired. Verify your number again.',
        });
      }
    } else {
      const isOtpValid = await otpService.verifyOtp(phone, 'registration', otp);
      if (!isOtpValid) {
        return error(res, { statusCode: 400, message: 'Invalid OTP' });
      }
    }

    // Final backstop. The OTP screen rejects taken numbers well before
    // this point, but /register is a public endpoint and must hold the
    // invariant on its own.
    //
    // Widened from a users-only lookup: phone is UNIQUE in all four
    // account tables and login resolves across all of them, so an
    // admin/rider phone registering again here would create a users row
    // whose password is silently ignored at sign-in (login authenticates
    // against the highest role found). See utils/phoneAccounts.js.
    const accounts = await findAccountsForPhone(phone);
    if (accounts.exists) {
      return error(res, {
        statusCode: 409,
        message: describePhoneConflict(accounts),
        code: PHONE_TAKEN_CODE,
      });
    }

    // The App Review demo number always lands in the sandbox, approved, no
    // matter which location the form sent — a reviewer testing sign-up must
    // never end up in a real zone's chat or delivery run. See
    // services/reviewDemoService.js.
    const isDemo = reviewDemo.isDemoPhone(phone);
    let targetLocationId = location_id;
    if (isDemo) {
      const { pg } = await reviewDemo.ensureSandbox();
      targetLocationId = pg.id;
    } else {
      const location = await Location.findByPk(location_id);
      if (!location || location.is_sandbox || !['zone', 'address'].includes(location.type)) {
        return error(res, { statusCode: 400, message: 'Invalid location' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      phone,
      password: hashedPassword,
      gender,
      occupation,
      city,
      location_id: targetLocationId,
      address,
      status: isDemo ? 'approved' : 'pending',
      is_phone_verified: true,
    });

    if (isDemo) {
      chatGroupSync
        .zoneForLocation(targetLocationId)
        .then((zoneId) => chatGroupSync.syncInBackground([zoneId], 'review demo registered'))
        .catch(() => { /* boot reconcile is the backstop */ });
    }

    return success(res, {
      statusCode: 201,
      message: 'Registration successful',
      data: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        status: user.status,
        is_phone_verified: user.is_phone_verified,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/login
// Body: { phone, password }
//
// Checks all three tables for the phone number in parallel, then logs in
// under the highest role found. Returns available_roles so the client
// knows whether to show a role switcher in the profile section.
// ---------------------------------------------------------------------------
const loginUser = async (req, res, next) => {
  try {
    const { phone, password } = req.body || {};

    if (typeof phone !== 'string' || typeof password !== 'string' || !phone || !password) {
      return error(res, {
        statusCode: 400,
        message: 'Phone and password are required',
      });
    }

    // A locked number is refused before any account lookup or password
    // comparison — see services/loginThrottleService.js.
    await loginThrottle.assertNotLocked(phone);

    // The reviewer's account repairs itself on a sign-in with the documented
    // password, so a previous reviewer deleting it cannot lock out the next.
    if (reviewDemo.isDemoPhone(phone) && reviewDemo.isDemoPassword(password)) {
      await reviewDemo.ensureDemoMember();
    }

    const accounts = await findAllRolesForPhone(phone);
    const { superAdminAccount, adminAccount, userAccount } = accounts;

    // Authenticate under the highest privilege this number holds — but
    // only counting roles that are actually usable. Suspending someone's
    // zone-admin role must not cost them their membership.
    const byPrivilege = [
      [superAdminAccount, 'super_admin'],
      [adminAccount,      'admin'],
      [userAccount,       'user'],
    ].filter(([candidate]) => candidate);

    if (byPrivilege.length === 0) {
      return error(res, {
        statusCode: 404,
        message: NO_ACCOUNT_MESSAGE,
        code: NO_ACCOUNT_CODE,
      });
    }

    const usable = byPrivilege.filter(([candidate]) => candidate.is_active !== false);
    const [account, role] = usable[0] || byPrivilege[0];

    // The password is checked BEFORE anything about the account's state is
    // revealed. Previously "still pending approval" / "rejected" /
    // "deactivated" came back to anyone who typed the number, password or
    // not — a free lookup of any member's approval status.
    const isPasswordValid = await bcrypt.compare(password, account.password);
    if (!isPasswordValid) {
      await loginThrottle.recordFailure(phone);
      return error(res, {
        statusCode: 401,
        message: 'Invalid phone or password',
        code: 'INVALID_CREDENTIALS',
      });
    }
    await loginThrottle.recordSuccess(phone);

    // Every role this number holds is suspended. 'Deactivated' means
    // exactly this — a super admin turned the account off and can turn it
    // back on. It is never how a deleted account presents itself, because
    // deletion removes the rows entirely.
    if (usable.length === 0) {
      return error(res, {
        statusCode: 403,
        message: 'This account has been deactivated. Contact an admin to restore it.',
        code: 'ACCOUNT_DEACTIVATED',
      });
    }

    // User-role accounts must be approved before they can log in.
    // For admin/super_admin the active flag is the only gate.
    if (role === 'user' && account.status !== 'approved') {
      return error(res, {
        statusCode: 403,
        message:
          account.status === 'pending'
            ? 'Your account is still pending approval'
            : 'Your account registration was rejected',
        code: account.status === 'pending' ? 'ACCOUNT_PENDING' : 'ACCOUNT_REJECTED',
      });
    }

    const { accessToken, refreshToken } = await authSessionService.issueSession(role, account);

    if ('last_login_at' in account.dataValues) {
      account.last_login_at = new Date();
      await account.save();
    }

    // Collect all roles this phone holds so the client can show the switcher.
    const availableRoles = deriveAvailableRoles(accounts);

    return success(res, {
      statusCode: 200,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        active_role: role,
        available_roles: availableRoles,
        profile: {
          id: account.id,
          name: account.name,
          phone: account.phone,
          ...(role === 'admin' ? { zone_location_id: account.zone_location_id } : {}),
          ...(account.user_id ? { user_id: account.user_id } : {}),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/switch-role
// Body: { role: 'user' | 'admin' | 'super_admin' }
// Auth: Bearer <access token>
//
// Issues a new token pair scoped to the requested role.
// The caller must already hold that role (verified by checking the DB).
// No password re-entry required — the current valid token is proof of identity.
// ---------------------------------------------------------------------------
const switchRole = async (req, res, next) => {
  try {
    const { role: requestedRole } = req.body;
    const validRoles = ['user', 'admin', 'super_admin', 'rider'];

    if (!requestedRole || !validRoles.includes(requestedRole)) {
      return error(res, {
        statusCode: 400,
        message: "role must be one of: 'user', 'admin', 'super_admin', 'rider'",
      });
    }

    // We already know the caller's current identity from the token.
    // Look up their phone so we can cross-reference all tables.
    let callerPhone = null;

    if (req.auth.role === 'super_admin') {
      const sa = await SuperAdmin.findByPk(req.auth.id, { attributes: ['phone'] });
      callerPhone = sa?.phone;
    } else if (req.auth.role === 'admin') {
      const adm = await Admin.findByPk(req.auth.id, { attributes: ['phone'] });
      callerPhone = adm?.phone;
    } else if (req.auth.role === 'rider') {
      const rdr = await Rider.findByPk(req.auth.id, { attributes: ['phone'] });
      callerPhone = rdr?.phone;
    } else {
      const usr = await User.findByPk(req.auth.id, { attributes: ['phone'] });
      callerPhone = usr?.phone;
    }

    if (!callerPhone) {
      return error(res, { statusCode: 404, message: 'Account not found' });
    }

    // Check all tables for this phone in parallel.
    const accounts = await findAllRolesForPhone(callerPhone);
    const { superAdminAccount, adminAccount, userAccount } = accounts;

    // Verify the requested role is actually held by this person.
    let targetAccount = null;
    if (requestedRole === 'super_admin') targetAccount = superAdminAccount;
    else if (requestedRole === 'admin') targetAccount = adminAccount;
    else if (requestedRole === 'user') targetAccount = userAccount;
    else if (requestedRole === 'rider') targetAccount = accounts.riderAccount;

    if (!targetAccount) {
      return error(res, {
        statusCode: 403,
        message: `You do not have the '${requestedRole}' role`,
      });
    }

    if (targetAccount.is_active === false) {
      return error(res, {
        statusCode: 403,
        message: 'This role account has been deactivated',
      });
    }

    // User role requires approval.
    if (requestedRole === 'user' && targetAccount.status !== 'approved') {
      return error(res, {
        statusCode: 403,
        message:
          targetAccount.status === 'pending'
            ? 'Your user account is still pending approval'
            : 'Your user account was rejected',
      });
    }

    const { accessToken, refreshToken } = await authSessionService.issueSession(
      requestedRole,
      targetAccount
    );

    // Switching between member-side roles replaces the app's session, so the
    // one being left is ended rather than left valid in the background. The
    // rider session is the exception: the app keeps it ALONGSIDE the member
    // session (see useAuthStore.switchRole), so neither is revoked.
    if (requestedRole !== 'rider' && req.auth.role !== 'rider' && req.auth.sid) {
      await authSessionService.revokeSession(req.auth.sid, 'role_switched');
    }

    const availableRoles = deriveAvailableRoles(accounts);

    return success(res, {
      statusCode: 200,
      message: `Switched to ${requestedRole}`,
      data: {
        accessToken,
        refreshToken,
        active_role: requestedRole,
        available_roles: availableRoles,
        profile: {
          id: targetAccount.id,
          name: targetAccount.name,
          phone: targetAccount.phone,
          ...(requestedRole === 'admin'
            ? { zone_location_id: targetAccount.zone_location_id }
            : {}),
          ...(requestedRole === 'rider'
            ? { zone_location_id: targetAccount.zone_location_id, user_id: targetAccount.user_id }
            : {}),
          ...(targetAccount.user_id && requestedRole !== 'rider'
            ? { user_id: targetAccount.user_id }
            : {}),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password/verify-otp
// Body: { phone, otp, newPassword }
// ---------------------------------------------------------------------------
const forgotPasswordReset = async (req, res, next) => {
  try {
    const { phone, otp, newPassword } = req.body;

    if (!phone || !otp || !newPassword) {
      return error(res, {
        statusCode: 400,
        message: 'Phone, OTP, and new password are required',
      });
    }

    if (!/^[6-9]\d{9}$/.test(phone)) {
      return error(res, {
        statusCode: 400,
        message: 'Phone must be a valid 10-digit Indian mobile number',
      });
    }

    if (newPassword.length < 6) {
      return error(res, {
        statusCode: 400,
        message: 'New password must be at least 6 characters',
      });
    }

    // Look the number up BEFORE consuming the code, so a typo'd number does
    // not burn the OTP on a path that cannot finish.
    const [superAdmin, admin, user, rider] = await Promise.all([
      SuperAdmin.scope('withPassword').findOne({ where: { phone } }),
      Admin.scope('withPassword').findOne({ where: { phone } }),
      User.scope('withPassword').findOne({ where: { phone } }),
      Rider.scope('withPassword').findOne({ where: { phone } }),
    ]);
    const accounts = [superAdmin, admin, user, rider].filter(Boolean);

    if (accounts.length === 0) {
      return error(res, {
        statusCode: 404,
        message: 'No account found with this phone number',
        code: NO_ACCOUNT_CODE,
      });
    }

    const isOtpValid = await otpService.verifyOtp(phone, 'forgot_password', otp);
    if (!isOtpValid) {
      return error(res, { statusCode: 400, message: 'Invalid or expired OTP' });
    }

    // One number is one person, whichever roles they hold. Resetting only
    // the highest-privilege row (as before) left the other roles on the old
    // password — a member whose admin row was reset still could not sign
    // in to the rider screen with the new one.
    const hash = await bcrypt.hash(newPassword, 10);
    await db.sequelize.transaction(async (transaction) => {
      for (const account of accounts) {
        account.password = hash;
        await account.save({ transaction });
      }
    });

    // A reset is what someone does when they think their password is known
    // to someone else. Every device signed in with the old one is signed
    // out, and a lockout from the guessing that prompted the reset is lifted.
    const subjects = await authSessionService.subjectsForPhone(phone);
    await authSessionService.revokeSubjects(subjects, 'password_reset');
    await loginThrottle.recordSuccess(phone);
    logger.info(`[auth] password reset for ${logger.maskPhone(phone)} (${accounts.length} account row(s))`);

    return success(res, {
      statusCode: 200,
      message: 'Password reset successfully. Sign in with your new password.',
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/refresh-token
// Body: { refreshToken: string }
//
// Rotates the session: the presented refresh token is retired and a new
// pair issued, with claims re-read from the database. See
// services/authSessionService.js for rotation, reuse detection, and why a
// refresh can no longer revive a removed role or a deleted account.
// ---------------------------------------------------------------------------
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body || {};

    if (!token || typeof token !== 'string') {
      return error(res, {
        statusCode: 400,
        message: 'Refresh token is required',
      });
    }

    const { accessToken, refreshToken: newRefreshToken } = await authSessionService.rotateSession(token);

    return success(res, {
      statusCode: 200,
      message: 'Token refreshed successfully',
      data: {
        accessToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// Body: { refreshToken: string }
//
// Ends the session this device holds. Authenticated by possession of the
// refresh token alone, so signing out still works when the access token has
// already expired. Always 200 — an unknown or expired token has no session
// left to end, which is the outcome the caller asked for.
// ---------------------------------------------------------------------------
const logout = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body || {};
    if (typeof token === 'string' && token) {
      await authSessionService.revokeByRefreshToken(token, 'signed_out');
    }
    return success(res, { statusCode: 200, message: 'Signed out' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  registerUser,
  loginUser,
  switchRole,
  forgotPasswordReset,
  refreshToken,
  logout,
};
