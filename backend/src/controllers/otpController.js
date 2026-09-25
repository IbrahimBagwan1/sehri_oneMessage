'use strict';

const jwt = require('jsonwebtoken');
const otpService = require('../services/otpService');
const { success, error } = require('../utils/response');
const {
  PHONE_TAKEN_CODE,
  findAccountsForPhone,
  describePhoneConflict,
} = require('../utils/phoneAccounts');

/**
 * Reject a registration OTP for a phone that already has an account.
 *
 * ONLY applies to purpose='registration'. The forgot-password flow
 * REQUIRES the account to exist, so running this check unscoped would
 * break password resets entirely.
 *
 * Returns true when the request was rejected (response already sent).
 */
const rejectIfPhoneTaken = async (res, phone, purpose) => {
  if (purpose !== 'registration') return false;

  const accounts = await findAccountsForPhone(phone);
  if (!accounts.exists) return false;

  error(res, {
    statusCode: 409,
    message: describePhoneConflict(accounts),
    code: PHONE_TAKEN_CODE,
  });
  return true;
};

// A phone-verification ticket is a short-lived JWT proving "this device
// proved control of this phone number just now". It exists because
// verifying an OTP CONSUMES it (otps.is_used = true), so once the
// dedicated verification screen checks the code, the registration form
// that follows can no longer re-verify the same code. Rather than
// leaving the OTP un-consumed (which would let it be replayed), we
// trade it for a signed ticket that /register accepts in its place.
//
// 15 minutes is enough to fill in the registration form without leaving
// a long-lived credential lying around. Signed with JWT_SECRET so no new
// secret has to be provisioned.
const VERIFICATION_TICKET_TTL = '15m';

const signVerificationTicket = (phone, purpose) =>
  jwt.sign({ phone, purpose, kind: 'phone_verification' }, process.env.JWT_SECRET, {
    expiresIn: VERIFICATION_TICKET_TTL,
  });

/**
 * Verify a phone-verification ticket. Returns the decoded payload when
 * the ticket is valid AND matches the phone + purpose being claimed;
 * null otherwise. Exported so authController can gate /register on it.
 */
const verifyVerificationTicket = (token, phone, purpose) => {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.kind !== 'phone_verification') return null;
    if (decoded.phone !== phone) return null;
    if (decoded.purpose !== purpose) return null;
    return decoded;
  } catch {
    return null;
  }
};

/**
 * POST /api/auth/send-otp
 * Body: { phone: string, purpose: 'registration' | 'forgot_password' }
 *
 * Generates and "sends" (console-logs, for now) an OTP for the given phone
 * number. Controller stays thin - all the actual logic lives in otpService
 * so it's reusable (the forgot-password flow can call this same service
 * function, just with a different `purpose`).
 *
 * Note: this file is deliberately separate from authController.js, which
 * is your teammate's file (registration logic) - keeping OTP logic here
 * avoids both of you editing the same file and hitting merge conflicts.
 */
const sendOtp = async (req, res, next) => {
  try {
    const { phone, purpose } = req.body;

    // Stop a registration OTP for an already-registered number BEFORE
    // spending an SMS on it. Three reasons this belongs here rather than
    // only at verify time:
    //   • every send costs real money at the provider
    //   • otpService starts a 60-second resend cooldown on success, so a
    //     later rejection would leave the user cooling down on a number
    //     they can never register anyway
    //   • the user learns in a second instead of after waiting for an
    //     SMS and typing a code
    // Scoped to purpose='registration' — forgot-password needs the
    // account to exist.
    if (await rejectIfPhoneTaken(res, phone, purpose)) return;

    const result = await otpService.sendOtp(phone, purpose);

    return success(res, {
      statusCode: 200,
      message: 'OTP sent successfully.',
      data: {
        expiresInMinutes: result.expiresInMinutes,
        otpLength: result.otpLength,
      },
    });
  } catch (err) {
    next(err); // handed to the global error handler in server.js
  }
};

/**
 * POST /api/auth/verify-otp
 * Body: { phone, purpose: 'registration' | 'forgot_password', otp }
 *
 * Checks the code and, on success, returns a short-lived verification
 * ticket the next step can present instead of the (now consumed) OTP.
 * This is what lets phone verification live on its own screen ahead of
 * the registration form.
 *
 * Re-checks phone availability as a RACE GUARD. send-otp already
 * rejected taken numbers, but minutes can pass between requesting and
 * entering a code, and the number could be claimed in that window by
 * another device. Cheap query, closes the gap.
 *
 * On account enumeration: this does surface whether a number is
 * registered. That's an accepted trade here, not an oversight — the
 * forgot-password endpoint already answers the same question (it 404s
 * with "No account found with this phone number"), so the surface
 * exists regardless, and both OTP endpoints are IP rate-limited. The
 * alternative — letting someone fill in an entire registration form
 * before telling them the number is taken — is a worse product for a
 * community app with no meaningful enumeration threat model.
 */
const verifyOtp = async (req, res, next) => {
  try {
    const { phone, purpose, otp } = req.body;

    // Check before consuming the code: a taken number shouldn't burn
    // the user's OTP on a path that can't proceed.
    if (await rejectIfPhoneTaken(res, phone, purpose)) return;

    const isValid = await otpService.verifyOtp(phone, purpose, otp);
    if (!isValid) {
      return error(res, {
        statusCode: 400,
        message: 'That code is incorrect or has expired. Request a new one.',
      });
    }

    return success(res, {
      statusCode: 200,
      message: 'Phone number verified.',
      data: {
        phone,
        purpose,
        verification_token: signVerificationTicket(phone, purpose),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { sendOtp, verifyOtp, verifyVerificationTicket };
