const winston = require('winston');

/**
 * logger.js — one log stream for the whole backend, with PII scrubbed on the
 * way out.
 *
 * REDACTION
 * Call sites are expected not to log personal data, and the ones that did
 * (OTP codes, full phone numbers) have been fixed. But a request log line
 * carries whatever URL the client asked for — `/users/search?q=98…` — and an
 * error message can quote a value back. So every line passes through
 * `redact()` as a last line of defence:
 *   • Indian mobile numbers  → 98*****210
 *   • Expo push tokens       → ExponentPushToken[…]
 *   • JWTs                   → [jwt]
 *
 * WHERE LOGS GO
 * Console always — that is what container platforms collect. Files only when
 * LOG_TO_FILE=true, and then size-capped and rotated, because an unbounded
 * combined.log on a small VPS is how a disk fills up at 3am.
 */

const PHONE = /(?<![0-9A-Za-z-])(?:\+?91[\s-]?)?([6-9]\d)\d{5}(\d{3})(?![0-9A-Za-z-])/g;
const PUSH_TOKEN = /Expo(nent)?PushToken\[[^\]]*\]/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

const redact = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .replace(JWT, '[jwt]')
    .replace(PUSH_TOKEN, 'ExponentPushToken[…]')
    .replace(PHONE, (_m, head, tail) => `${head}*****${tail}`);
};

const redactFormat = winston.format((info) => {
  info.message = redact(info.message);
  if (info.stack) info.stack = redact(info.stack);
  return info;
});

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const transports = [
  new winston.transports.Console({
    // Tests assert on behaviour, not log output; keep their output readable.
    silent: isTest && process.env.LOG_IN_TESTS !== 'true',
  }),
];

if (process.env.LOG_TO_FILE === 'true') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 20 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
    })
  ),
  transports,
});

/** "9141687582" → "91*****582". For call sites that name a number deliberately. */
const maskPhone = (phone) => {
  if (typeof phone !== 'string' || phone.length < 6) return '******';
  return `${phone.slice(0, 2)}${'*'.repeat(Math.max(1, phone.length - 5))}${phone.slice(-3)}`;
};

module.exports = logger;
module.exports.redact = redact;
module.exports.maskPhone = maskPhone;
