'use strict';

/**
 * env.js — validate the environment once, at boot, and refuse to start on a
 * bad one.
 *
 * WHY THIS EXISTS
 * Every setting used to be read ad hoc with `process.env.X || default`. That
 * turns a typo or an EMPTY value into a silent default: `JWT_SECRET=` in a
 * production .env signs every token with the empty string, and a blank
 * `DB_PASS` surfaces twenty minutes later as a confusing connection error
 * rather than at deploy time. An empty string is treated as "missing" here,
 * on purpose — that was the actual failure this project hit before.
 *
 * Call validateEnv() before anything connects to anything. It throws one
 * error that lists every problem at once, so a broken deploy is fixed in one
 * pass rather than one variable at a time.
 */

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

const isProduction = () => process.env.NODE_ENV === 'production';
const isTest = () => process.env.NODE_ENV === 'test';

/** Parse a jsonwebtoken-style duration ("15m", "24h", "30d", "900") into seconds. */
const durationSeconds = (value) => {
  if (isBlank(value)) return null;
  const m = String(value).trim().match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
};

/** Comma-separated list → trimmed, non-empty entries. */
const list = (value) =>
  (value || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * @returns {{ warnings: string[] }} — problems worth logging but not fatal
 * @throws  {Error} listing every fatal problem
 */
const validateEnv = () => {
  const errors = [];
  const warnings = [];
  const prod = isProduction();

  // --- always required -------------------------------------------------
  for (const name of ['DB_HOST', 'DB_NAME', 'DB_USER', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (isBlank(process.env[name])) errors.push(`${name} is missing or empty`);
  }

  // A blank DB password is a legitimate local MySQL setup, never a
  // production one.
  if (prod && isBlank(process.env.DB_PASS)) errors.push('DB_PASS is empty — not allowed in production');

  // --- JWT --------------------------------------------------------------
  const access = process.env.JWT_SECRET || '';
  const refresh = process.env.JWT_REFRESH_SECRET || '';
  if (access && access.length < 32) errors.push('JWT_SECRET must be at least 32 characters');
  if (refresh && refresh.length < 32) errors.push('JWT_REFRESH_SECRET must be at least 32 characters');
  // Identical secrets would let a 30-day refresh token be presented as an
  // access token. The token `typ` claim also blocks that, but two keys are
  // the belt to that braces.
  if (access && refresh && access === refresh) {
    errors.push('JWT_SECRET and JWT_REFRESH_SECRET must be different');
  }

  const accessTtl = durationSeconds(process.env.JWT_ACCESS_EXPIRES_IN || '15m');
  if (accessTtl == null) {
    errors.push('JWT_ACCESS_EXPIRES_IN is not a valid duration (e.g. 15m)');
  } else if (prod && accessTtl > 3600) {
    // Access tokens are not checked against the session table on every
    // request, so their lifetime IS the window in which a revoked session
    // still works. Long-lived access tokens undo refresh revocation.
    warnings.push(`JWT_ACCESS_EXPIRES_IN is ${process.env.JWT_ACCESS_EXPIRES_IN}; keep it at 1h or less in production (15m recommended)`);
  }
  if (durationSeconds(process.env.JWT_REFRESH_EXPIRES_IN || '30d') == null) {
    errors.push('JWT_REFRESH_EXPIRES_IN is not a valid duration (e.g. 30d)');
  }

  // --- OTP --------------------------------------------------------------
  // The 'local' provider exists for development: it generates the code and
  // writes it to the log. In production that would mean no SMS is ever sent
  // and every code sits in a log file.
  const otpProvider = process.env.OTP_PROVIDER || 'local';
  if (prod && otpProvider !== 'messagecentral') {
    errors.push("OTP_PROVIDER must be 'messagecentral' in production (the local provider only logs codes)");
  }
  if (otpProvider === 'messagecentral') {
    for (const name of ['MESSAGECENTRAL_AUTH_TOKEN', 'MESSAGECENTRAL_CUSTOMER_ID']) {
      if (isBlank(process.env[name])) errors.push(`${name} is required when OTP_PROVIDER=messagecentral`);
    }
  }

  // --- CORS ---------------------------------------------------------------
  // The mobile app does not send an Origin header, so CORS only governs
  // browsers. In production an unset CORS_ORIGIN means "no browser origin
  // is allowed", never "every origin is".
  if (prod && process.env.CORS_ORIGIN === '*') {
    errors.push("CORS_ORIGIN='*' is not allowed in production — list the exact origins, or leave it empty");
  }

  // --- optional integrations: warn, don't fail --------------------------
  if (isBlank(process.env.GOOGLE_MAPS_API_KEY)) {
    warnings.push('GOOGLE_MAPS_API_KEY is not set — ETAs, routes and reverse geocoding are disabled');
  }
  const cloudinaryOk = !isBlank(process.env.CLOUDINARY_URL)
    || (!isBlank(process.env.CLOUDINARY_CLOUD_NAME)
      && !isBlank(process.env.CLOUDINARY_API_KEY)
      && !isBlank(process.env.CLOUDINARY_API_SECRET));
  if (!cloudinaryOk) warnings.push('Cloudinary is not configured — donation screenshots cannot be uploaded');
  if (isBlank(process.env.PAYMENT_CONTACT_NUMBER)) {
    warnings.push('PAYMENT_CONTACT_NUMBER is not set — the built-in default number is shown');
  }

  // --- App Review demo account ------------------------------------------
  if (process.env.REVIEW_DEMO_ENABLED === 'true') {
    const phone = process.env.REVIEW_DEMO_PHONE;
    if (!/^[6-9]\d{9}$/.test(phone || '')) {
      errors.push('REVIEW_DEMO_PHONE must be a valid 10-digit number when REVIEW_DEMO_ENABLED=true');
    }
    if (isBlank(process.env.REVIEW_DEMO_PASSWORD) || process.env.REVIEW_DEMO_PASSWORD.length < 10) {
      errors.push('REVIEW_DEMO_PASSWORD must be at least 10 characters when REVIEW_DEMO_ENABLED=true');
    }
    if (!/^\d{6}$/.test(process.env.REVIEW_DEMO_OTP || '')) {
      errors.push('REVIEW_DEMO_OTP must be exactly 6 digits when REVIEW_DEMO_ENABLED=true');
    }
    if (prod) warnings.push('REVIEW_DEMO_ENABLED=true — the App Review sandbox account is live. Turn it off once review passes.');
  }

  if (errors.length) {
    const err = new Error(
      `Invalid environment — refusing to start:\n  - ${errors.join('\n  - ')}`
    );
    err.envErrors = errors;
    throw err;
  }
  return { warnings };
};

module.exports = {
  validateEnv,
  isProduction,
  isTest,
  isBlank,
  durationSeconds,
  list,
};
