'use strict';

const jwt = require('jsonwebtoken');
const otpService = require('../services/otpService');
const { success, error } = require('../utils/response');

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
 * Deliberately does NOT reveal whether the phone is already registered —
 * that would turn this into an account-enumeration oracle. Registration
 * itself returns the 409 once the full form is submitted.
 */
const verifyOtp = async (req, res, next) => {
  try {
    const { phone, purpose, otp } = req.body;

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
