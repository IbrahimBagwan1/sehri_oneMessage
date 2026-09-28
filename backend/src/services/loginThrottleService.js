'use strict';

/**
 * loginThrottleService.js — password guessing protection that cannot be
 * turned against the account's owner.
 *
 * THE PROBLEM WITH A PLAIN PER-PHONE LOCKOUT
 * Counting failures per phone number (the first version) stops guessing,
 * but it hands a weapon to anyone who knows a member's number: five wrong
 * passwords lock the real owner out, and repeating it keeps them out.
 *
 * TWO COUNTERS INSTEAD
 *   1. Per phone + source network. PAIR_MAX_FAILURES wrong passwords within
 *      WINDOW_MS lock that phone FROM THAT NETWORK, doubling from
 *      PAIR_BASE_LOCK_MS up to PAIR_MAX_LOCK_MS. The owner, on their own
 *      network, is unaffected. IPv6 sources are grouped by /56 so rotating
 *      through one allocation does not reset the count.
 *   2. Per phone from anywhere. Only an attack spread over many networks
 *      reaches PHONE_MAX_FAILURES within PHONE_WINDOW_MS. Then password
 *      sign-in for that number switches to "reset with an OTP first" for
 *      PHONE_STEP_UP_MS — not a lock: the owner receives the SMS and is back
 *      in within a minute, and the attacker, who does not have the phone,
 *      is stopped completely.
 *
 * A correct password clears the pair and the phone counter. A password reset
 * (which proves possession of the phone) clears everything for the number.
 *
 * Counters live in MySQL so every instance and every restart agree. The
 * per-IP rate limit on the route (middleware/rateLimits.js) remains as a
 * coarse backstop against one client sweeping many numbers.
 */

const { Op } = require('sequelize');
const { ipKeyGenerator } = require('express-rate-limit');
const db = require('../models');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

const { LoginThrottle } = db;

const PAIR_MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const PAIR_BASE_LOCK_MS = 5 * 60 * 1000;
const PAIR_MAX_LOCK_MS = 60 * 60 * 1000;

const PHONE_MAX_FAILURES = 25;
const PHONE_WINDOW_MS = 60 * 60 * 1000;
const PHONE_STEP_UP_MS = 60 * 60 * 1000;

const pairKey = (phone, ip) => `pi:${phone}:${ipKeyGenerator(ip || 'unknown', 56)}`.slice(0, 120);
const phoneKey = (phone) => `p:${phone}`;

const minutesUntil = (date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60000));

/**
 * Throw 429 when this attempt must not be evaluated:
 *   LOGIN_LOCKED   — this phone, from this network, is cooling down
 *   LOGIN_STEP_UP  — this phone needs an OTP reset before password sign-in
 */
const assertNotLocked = async (phone, ip) => {
  const now = new Date();
  const [pair, whole] = await Promise.all([
    LoginThrottle.findByPk(pairKey(phone, ip)),
    LoginThrottle.findByPk(phoneKey(phone)),
  ]);
  if (whole?.locked_until && whole.locked_until > now) {
    throw new AppError(
      'For your security, sign-in with a password is paused for this number after many failed '
      + 'attempts. Use "Forgot password" to reset it with an OTP — it only takes a minute.',
      429,
      'LOGIN_STEP_UP'
    );
  }
  if (pair?.locked_until && pair.locked_until > now) {
    throw new AppError(
      `Too many incorrect attempts. Try again in ${minutesUntil(pair.locked_until)} minute(s), `
      + 'or reset your password with an OTP.',
      429,
      'LOGIN_LOCKED'
    );
  }
};

/** Bump one counter; returns the updated row. */
const bump = async (key, windowMs, now) => {
  const [row] = await LoginThrottle.findOrCreate({
    where: { throttle_key: key },
    defaults: { throttle_key: key, failures: 0, window_started_at: now, lockouts: 0 },
  });
  const expired = !row.window_started_at || now - row.window_started_at > windowMs;
  row.failures = expired ? 1 : row.failures + 1;
  row.window_started_at = expired ? now : row.window_started_at;
  return row;
};

/** Record one wrong password. */
const recordFailure = async (phone, ip) => {
  const now = new Date();

  const pair = await bump(pairKey(phone, ip), WINDOW_MS, now);
  if (pair.failures >= PAIR_MAX_FAILURES) {
    const lockMs = Math.min(PAIR_MAX_LOCK_MS, PAIR_BASE_LOCK_MS * 2 ** pair.lockouts);
    pair.locked_until = new Date(now.getTime() + lockMs);
    pair.lockouts += 1;
    pair.failures = 0;
    pair.window_started_at = null;
    logger.warn(`[auth] sign-in locked for ${logger.maskPhone(phone)} from one source for ${lockMs / 60000} min`);
  }
  await pair.save();

  const whole = await bump(phoneKey(phone), PHONE_WINDOW_MS, now);
  if (whole.failures >= PHONE_MAX_FAILURES) {
    whole.locked_until = new Date(now.getTime() + PHONE_STEP_UP_MS);
    whole.failures = 0;
    whole.window_started_at = null;
    logger.warn(`[auth] ${logger.maskPhone(phone)} needs an OTP reset before password sign-in (distributed failures)`);
  }
  await whole.save();
};

/** A correct password: clear this source's pair and the phone-wide count. */
const recordSuccess = async (phone, ip) => {
  await LoginThrottle.destroy({ where: { throttle_key: [pairKey(phone, ip), phoneKey(phone)] } });
};

/** Proven possession of the phone (OTP reset): clear everything for it. */
const clearForPhone = async (phone) => {
  await LoginThrottle.destroy({
    where: {
      [Op.or]: [
        { throttle_key: phoneKey(phone) },
        { throttle_key: { [Op.like]: `pi:${phone}:%` } },
      ],
    },
  });
};

/**
 * Housekeeping: forget counters untouched for a day. A guesser who never
 * gets in leaves a row keyed by the phone and their network address; without
 * this it would be kept forever. A day keeps the lock escalation meaningful
 * (every lock is an hour at most) without holding the address longer.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const purgeStale = async () => {
  const now = new Date();
  const n = await LoginThrottle.destroy({
    where: {
      updated_at: { [Op.lt]: new Date(now.getTime() - STALE_AFTER_MS) },
      [Op.or]: [{ locked_until: null }, { locked_until: { [Op.lt]: now } }],
    },
  });
  if (n) logger.info(`[auth] purged ${n} stale login throttle row(s)`);
  return n;
};

module.exports = {
  assertNotLocked,
  recordFailure,
  recordSuccess,
  clearForPhone,
  purgeStale,
  PAIR_MAX_FAILURES,
  PHONE_MAX_FAILURES,
};
