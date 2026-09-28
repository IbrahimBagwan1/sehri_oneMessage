'use strict';

/**
 * loginThrottleService.js — brute-force protection for password sign-in.
 *
 * Two layers, because they stop different attacks:
 *   • an IP rate limit on the route (routes/authRoutes.js) stops one client
 *     hammering many numbers;
 *   • this per-PHONE lockout stops many clients guessing one number's
 *     password, which an IP limit cannot see.
 *
 * Policy: MAX_FAILURES wrong passwords within WINDOW_MS locks the number for
 * BASE_LOCK_MS, doubling on each consecutive lockout up to MAX_LOCK_MS. A
 * correct password clears the record. The count lives in the database so it
 * holds across restarts and across server instances.
 *
 * A lockout blocks password sign-in only. Forgot-password still works, so
 * the real owner of a targeted number is never locked out of their account —
 * they reset by OTP, which proves possession of the phone.
 */

const db = require('../models');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

const { LoginThrottle } = db;

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCK_MS = 5 * 60 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;

const minutesUntil = (date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60000));

/** Throw 429 if this number is currently locked. */
const assertNotLocked = async (phone) => {
  const row = await LoginThrottle.findByPk(phone);
  if (row?.locked_until && row.locked_until > new Date()) {
    throw new AppError(
      `Too many incorrect attempts. Try again in ${minutesUntil(row.locked_until)} minute(s), `
      + 'or reset your password with an OTP.',
      429,
      'LOGIN_LOCKED'
    );
  }
};

/** Record one wrong password. */
const recordFailure = async (phone) => {
  const now = new Date();
  const [row] = await LoginThrottle.findOrCreate({
    where: { phone },
    defaults: { phone, failures: 0, window_started_at: now, lockouts: 0 },
  });

  const windowExpired = !row.window_started_at || now - row.window_started_at > WINDOW_MS;
  const failures = windowExpired ? 1 : row.failures + 1;
  const updates = {
    failures,
    window_started_at: windowExpired ? now : row.window_started_at,
  };

  if (failures >= MAX_FAILURES) {
    const lockMs = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** row.lockouts);
    updates.locked_until = new Date(now.getTime() + lockMs);
    updates.lockouts = row.lockouts + 1;
    updates.failures = 0;
    updates.window_started_at = null;
    logger.warn(`[auth] sign-in locked for ${logger.maskPhone(phone)} for ${lockMs / 60000} min`);
  }
  await row.update(updates);
};

/** A correct password clears the record. */
const recordSuccess = async (phone) => {
  await LoginThrottle.destroy({ where: { phone } });
};

module.exports = {
  assertNotLocked,
  recordFailure,
  recordSuccess,
  MAX_FAILURES,
};
