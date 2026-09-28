'use strict';

/**
 * otpService.js — one-time codes for registration and password reset.
 *
 * HARDENING (release audit)
 *   • Codes are never logged in production. The local provider — which
 *     exists only for development — logs them outside production so a
 *     developer can sign up without an SMS account; env.js refuses to boot
 *     production on that provider at all.
 *   • Attempts are counted with an atomic UPDATE before the comparison, not
 *     read-compare-increment. Five guesses fired in parallel used to all read
 *     `attempts = 0` and all get checked, so the "5 attempts" limit could be
 *     multiplied by however many requests an attacker could fire at once.
 *   • Consuming a code is a conditional UPDATE, so two simultaneous correct
 *     submissions cannot both succeed.
 *   • A per-number daily cap bounds SMS spend. OTP endpoints are a known
 *     target for SMS toll fraud (triggering many sends to premium numbers);
 *     the IP limit alone does not stop a distributed run against one number.
 *   • The App Review demo number (services/reviewDemoService.js) is issued
 *     its fixed code without an SMS. No other number can use that code.
 */

const { Op } = require('sequelize');
const db = require('../models');
const { generateOtp, hashOtp, compareOtp, OTP_LENGTH } = require('../utils/otp');
const messageCentralClient = require('./messageCentralClient');
const reviewDemo = require('./reviewDemoService');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

const RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;
const MAX_SENDS_PER_DAY = 10;

const getProvider = () => (process.env.OTP_PROVIDER === 'messagecentral' ? 'messagecentral' : 'local');

const sendOtp = async (phone, purpose, role = 'user') => {
  const now = new Date();

  const recentOtp = await db.OTP.findOne({
    where: {
      phone,
      purpose,
      is_used: false,
      expires_at: { [Op.gt]: now },
    },
    order: [['createdAt', 'DESC']],
  });
  if (recentOtp) {
    const secondsSinceSent = (now - new Date(recentOtp.createdAt)) / 1000;
    if (secondsSinceSent < RESEND_COOLDOWN_SECONDS) {
      const waitTime = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceSent);
      throw new AppError(
        `Please wait ${waitTime} second(s) before requesting another OTP.`,
        429,
        'OTP_COOLDOWN'
      );
    }
  }

  const sentToday = await db.OTP.count({
    where: { phone, createdAt: { [Op.gt]: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
  if (sentToday >= MAX_SENDS_PER_DAY) {
    throw new AppError(
      'Too many codes have been requested for this number today. Please try again tomorrow.',
      429,
      'OTP_DAILY_LIMIT'
    );
  }

  await db.OTP.update(
    { is_used: true },
    { where: { phone, purpose, is_used: false } }
  );

  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 5;
  const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

  if (reviewDemo.isDemoPhone(phone)) {
    // Reviewers cannot receive an SMS on an Indian number. The fixed code
    // is stored hashed like any other; nothing is sent and nothing logged.
    await db.OTP.create({
      phone,
      purpose,
      role,
      provider: 'local',
      otp_hash: await hashOtp(process.env.REVIEW_DEMO_OTP),
      expires_at: expiresAt,
    });
    logger.info(`[otp] review demo code issued [${purpose}]`);
  } else if (getProvider() === 'messagecentral') {
    const { verificationId } = await messageCentralClient.sendOtp(phone);

    await db.OTP.create({
      phone,
      purpose,
      role,
      provider: 'messagecentral',
      verification_id: verificationId,
      expires_at: expiresAt,
    });

    logger.info(`[otp] sent via MessageCentral to ${logger.maskPhone(phone)} [${purpose}]`);
  } else {
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);

    await db.OTP.create({
      phone,
      purpose,
      role,
      provider: 'local',
      otp_hash: otpHash,
      expires_at: expiresAt,
    });

    // Development only — env.js makes the local provider impossible in
    // production, and this line is guarded again in case that ever changes.
    if (process.env.NODE_ENV !== 'production') {
      logger.info(`[otp] DEV code for ${logger.maskPhone(phone)} [${purpose}]: ${otp} (expires in ${expiryMinutes} min)`);
    }
  }

  // otpLength is returned so the client can size its input and copy
  // ("Enter the N-digit code") off the server rather than hardcoding a
  // number that drifts when the provider changes.
  return { expiresInMinutes: expiryMinutes, otpLength: OTP_LENGTH };
};

const verifyOtp = async (phone, purpose, code) => {
  const otpRecord = await db.OTP.findOne({
    where: {
      phone,
      purpose,
      is_used: false,
      expires_at: { [Op.gt]: new Date() },
    },
    order: [['createdAt', 'DESC']],
  });

  if (!otpRecord) {
    throw new AppError('OTP not found or expired', 400, 'OTP_EXPIRED');
  }

  // Claim an attempt atomically. If the row is already at the limit (or a
  // parallel request just took the last attempt), nothing is updated.
  const [claimed] = await db.OTP.update(
    { attempts: db.sequelize.literal('attempts + 1') },
    { where: { id: otpRecord.id, attempts: { [Op.lt]: MAX_OTP_ATTEMPTS }, is_used: false } }
  );
  if (claimed === 0) {
    throw new AppError('Too many failed attempts. Please request a new OTP.', 429, 'OTP_ATTEMPTS');
  }

  let isValid;
  if (otpRecord.provider === 'messagecentral') {
    isValid = await messageCentralClient.validateOtp(otpRecord.verification_id, String(code));
  } else {
    isValid = await compareOtp(String(code), otpRecord.otp_hash);
  }
  if (!isValid) return false;

  // Consume exactly once. A second, simultaneous correct submission finds
  // is_used already true and fails like a wrong code would.
  const [consumed] = await db.OTP.update(
    { is_used: true },
    { where: { id: otpRecord.id, is_used: false } }
  );
  return consumed === 1;
};

module.exports = { sendOtp, verifyOtp, RESEND_COOLDOWN_SECONDS, MAX_OTP_ATTEMPTS, MAX_SENDS_PER_DAY };
