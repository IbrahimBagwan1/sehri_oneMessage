'use strict';

/**
 * rateLimits.js — every rate limit in one place.
 *
 * TWO KINDS OF KEY
 *   • Per IP, for unauthenticated endpoints. Deliberately generous: Indian
 *     mobile carriers put thousands of subscribers behind one CGNAT address,
 *     so a tight per-IP limit on sign-in would lock out a whole
 *     neighbourhood at 10 pm when the poll opens. The per-PHONE lockout in
 *     services/loginThrottleService.js is what actually stops password
 *     guessing; the IP limit is a coarse backstop against one client
 *     sweeping many numbers.
 *   • Per account, for authenticated actions that cost something or can be
 *     abused at volume — chat spam, report flooding, screenshot uploads,
 *     push broadcasts.
 *
 * Counts are in memory, per process. With a single instance that is exact;
 * behind a load balancer each instance counts separately, which loosens
 * the per-IP limits by the instance count — acceptable for backstops. The
 * limits that must hold globally (sign-in lockout, OTP attempts, OTP daily
 * cap) are stored in MySQL instead.
 */

const rateLimit = require('express-rate-limit');

const MINUTE = 60 * 1000;

const tooMany = (message) => ({ success: false, message, errors: null, code: 'RATE_LIMITED' });

const perIp = (windowMs, limit, message) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: tooMany(message),
});

/** Keyed on the signed-in account. Must run after verifyToken. */
const perAccount = (windowMs, limit, message) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.auth?.role || 'anon'}:${req.auth?.id || req.ip}`,
  // The key is an account id, not an address, so the IPv6-subnet check the
  // library applies to IP keys does not apply here.
  validate: { keyGeneratorIpFallback: false },
  message: tooMany(message),
});

module.exports = {
  // --- unauthenticated -------------------------------------------------
  signIn: perIp(15 * MINUTE, 60, 'Too many sign-in attempts from this network. Please wait a few minutes.'),
  passwordReset: perIp(15 * MINUTE, 20, 'Too many password reset attempts. Please wait a few minutes.'),
  refresh: perIp(15 * MINUTE, 600, 'Too many session refreshes from this network.'),

  // --- per account -----------------------------------------------------
  chatSend: perAccount(MINUTE, 30, 'You are sending messages too quickly. Please slow down.'),
  chatReport: perAccount(60 * MINUTE, 30, 'You have sent a lot of reports. Our team is reviewing them.'),
  donationSubmit: perAccount(60 * MINUTE, 10, 'Too many donation submissions. Please try again later.'),
  broadcast: perAccount(60 * MINUTE, 10, 'Broadcast limit reached for this hour.'),
  feedback: perAccount(60 * MINUTE, 10, 'You have sent a lot of feedback recently. Please try again later.'),
};
