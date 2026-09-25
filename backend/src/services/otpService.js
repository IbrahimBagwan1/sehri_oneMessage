'use strict';
const { Op } = require('sequelize');
const db = require('../models');
const { generateOtp, hashOtp, compareOtp, OTP_LENGTH } = require('../utils/otp');
const messageCentralClient = require('./messageCentralClient');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

const RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;

const getProvider = () => process.env.OTP_PROVIDER === 'messagecentral' ? 'messagecentral' : 'local';

const sendOtp = async (phone, purpose, role = 'user') => {
  const now = new Date();
  const provider = getProvider();

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
        429
      );
    }
  }

  await db.OTP.update(
    { is_used: true },
    { where: { phone, purpose, is_used: false } }
  );

  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 5;
  const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

  if (provider === 'messagecentral') {
    const { verificationId } = await messageCentralClient.sendOtp(phone);

    await db.OTP.create({
      phone,
      purpose,
      role,
      provider: 'messagecentral',
      verification_id: verificationId,
      expires_at: expiresAt,
    });

    logger.info(`📱 OTP sent via MessageCentral for ${phone} [${purpose}]`);
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

    logger.info(`📱 OTP for ${phone} [${purpose}]: ${otp} (expires in ${expiryMinutes} min)`);
  }

  // otpLength is returned so the client can size its input and copy
  // ("Enter the N-digit code") off the server rather than hardcoding a
  // number that drifts when the provider changes. Both the local
  // generator and MessageCentral are pinned to OTP_LENGTH.
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
    throw new AppError('OTP not found or expired', 400);
  }

  if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
    throw new AppError('Too many failed attempts. Please request a new OTP.', 429);
  }

  let isValid;
  if (otpRecord.provider === 'messagecentral') {
    isValid = await messageCentralClient.validateOtp(otpRecord.verification_id, code);
  } else {
    isValid = await compareOtp(code, otpRecord.otp_hash);
  }

  if (!isValid) {
    await otpRecord.increment('attempts');
    return false;
  }

  await otpRecord.update({ is_used: true });
  return true;
};

module.exports = { sendOtp, verifyOtp, RESEND_COOLDOWN_SECONDS };
