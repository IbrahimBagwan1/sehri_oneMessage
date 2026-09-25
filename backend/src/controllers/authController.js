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
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { User, Location, Admin, SuperAdmin, Rider } = db;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds the JWT payload for a given role + account record.
 *
 * user_id is included in admin/super_admin tokens when the account has a
 * linked users row. This lets those roles hit user-scoped routes (voting,
 * poll history, etc.) without needing a separate login.
 */
const buildTokenPayload = (role, account) => {
  const payload = { id: account.id, role };

  if (role === 'admin') {
    payload.zone_location_id = account.zone_location_id;
  }

  if (role === 'rider') {
    if (account.zone_location_id) payload.zone_location_id = account.zone_location_id;
    if (account.user_id) payload.user_id = account.user_id;
  }

  // Carry the linked user identity for admin and super_admin so they can
  // act as a regular user when the token is active for that role.
  if ((role === 'admin' || role === 'super_admin') && account.user_id) {
    payload.user_id = account.user_id;
  }

  return payload;
};

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
 */
const deriveAvailableRoles = ({ superAdminAccount, adminAccount, userAccount, riderAccount }) => {
  const roles = [];
  if (userAccount) roles.push('user');
  if (adminAccount) roles.push('admin');
  if (superAdminAccount) roles.push('super_admin');
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

    const location = await Location.findByPk(location_id);
    if (!location || !['zone', 'address'].includes(location.type)) {
      return error(res, { statusCode: 400, message: 'Invalid location' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      phone,
      password: hashedPassword,
      gender,
      occupation,
      city,
      location_id,
      address,
      status: 'pending',
      is_phone_verified: true,
    });

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
    const { phone, password } = req.body;

    if (!phone || !password) {
      return error(res, {
        statusCode: 400,
        message: 'Phone and password are required',
      });
    }

    const accounts = await findAllRolesForPhone(phone);
    const { superAdminAccount, adminAccount, userAccount } = accounts;

    // Determine which account to authenticate against (highest privilege first).
    let account = null;
    let role = null;

    if (superAdminAccount) {
      account = superAdminAccount;
      role = 'super_admin';
    } else if (adminAccount) {
      account = adminAccount;
      role = 'admin';
    } else if (userAccount) {
      account = userAccount;
      role = 'user';
    }

    if (!account) {
      return error(res, {
        statusCode: 401,
        message: 'Invalid phone or password',
      });
    }

    if (account.is_active === false) {
      return error(res, {
        statusCode: 403,
        message: 'This account has been deactivated',
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
      });
    }

    const isPasswordValid = await bcrypt.compare(password, account.password);
    if (!isPasswordValid) {
      return error(res, {
        statusCode: 401,
        message: 'Invalid phone or password',
      });
    }

    const tokenPayload = buildTokenPayload(role, account);
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

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

    const tokenPayload = buildTokenPayload(requestedRole, targetAccount);
    const accessToken = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

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

    const isOtpValid = await otpService.verifyOtp(phone, 'forgot_password', otp);
    if (!isOtpValid) {
      return error(res, { statusCode: 400, message: 'Invalid or expired OTP' });
    }

    // Find the account — same priority order as login.
    const account =
      (await SuperAdmin.scope('withPassword').findOne({ where: { phone } })) ||
      (await Admin.scope('withPassword').findOne({ where: { phone } })) ||
      (await User.scope('withPassword').findOne({ where: { phone } }));

    if (!account) {
      return error(res, {
        statusCode: 404,
        message: 'No account found with this phone number',
      });
    }

    account.password = await bcrypt.hash(newPassword, 10);
    await account.save();

    return success(res, {
      statusCode: 200,
      message: 'Password reset successfully',
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/auth/refresh-token
// Body: { refreshToken: string }
//
// Verifies the refresh token, issues a fresh access + refresh token pair.
// Carries forward all fields in the original payload including user_id.
// ---------------------------------------------------------------------------
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return error(res, {
        statusCode: 400,
        message: 'Refresh token is required',
      });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch (err) {
      return error(res, {
        statusCode: 401,
        message: 'Invalid or expired refresh token',
      });
    }

    // Rebuild the payload, carrying forward every field that was in the original.
    const payload = { id: decoded.id, role: decoded.role };

    // Admin and rider tokens both carry zone_location_id — admins strictly,
    // riders optionally (null = serves every zone). Carrying it forward is
    // what lets Socket.IO's subscribe_tracking auto-scope survive refreshes.
    if ((decoded.role === 'admin' || decoded.role === 'rider') && decoded.zone_location_id) {
      payload.zone_location_id = decoded.zone_location_id;
    }

    // Preserve user_id so admin/super_admin/rider keep their user-side identity
    // across silent token refreshes.
    if (decoded.user_id) {
      payload.user_id = decoded.user_id;
    }

    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    return success(res, {
      statusCode: 200,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });
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
};
