'use strict';

const AppError = require('../utils/appError');

const BASE_URL = 'https://cpaas.messagecentral.com';
const COUNTRY_CODE = '91';

// MessageCentral defaults to a 4-digit OTP when `otpLength` is omitted,
// while our local fallback generator (utils/otp.js) produces 6 digits.
// That mismatch meant the code length depended on which provider was
// configured, and the registration screen had to guess. We pin the
// provider to the same length our local generator uses so the code is
// 6 digits everywhere, regardless of OTP_PROVIDER.
const { OTP_LENGTH } = require('../utils/otp');

const sendOtp = async (phone) => {
  const url = new URL(`${BASE_URL}/verification/v3/send`);
  url.searchParams.set('customerId', process.env.MESSAGECENTRAL_CUSTOMER_ID);
  url.searchParams.set('countryCode', COUNTRY_CODE);
  url.searchParams.set('mobileNumber', phone);
  url.searchParams.set('flowType', 'SMS');
  url.searchParams.set('otpLength', String(OTP_LENGTH));

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      authToken: process.env.MESSAGECENTRAL_AUTH_TOKEN,
    },
  });

  const rawText = await response.text();

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new AppError('MessageCentral returned a non-JSON response.', 502);
  }

  if (!response.ok || !data?.data?.verificationId) {
    throw new AppError('Failed to send OTP via SMS provider. Please try again.', 502);
  }

  return { verificationId: String(data.data.verificationId) };
};

const validateOtp = async (verificationId, code) => {
  const url = new URL(`${BASE_URL}/verification/v3/validateOtp`);
  url.searchParams.set('customerId', process.env.MESSAGECENTRAL_CUSTOMER_ID);
  url.searchParams.set('verificationId', verificationId);
  url.searchParams.set('code', code);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      authToken: process.env.MESSAGECENTRAL_AUTH_TOKEN,
    },
  });

  const rawText = await response.text();



  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new AppError('MessageCentral returned a non-JSON validation response.', 502);
  }

  return data?.data?.verificationStatus === 'VERIFICATION_COMPLETED';
};

module.exports = { sendOtp, validateOtp };