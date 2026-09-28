'use strict';

/**
 * An error that carries an HTTP status code, so the global error handler
 * in server.js can respond with the right status instead of always 500.
 *
 * `code` is the optional machine-readable identifier the response envelope
 * already supports (see utils/response.js) — for errors the client needs to
 * branch on rather than just display.
 */
class AppError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // distinguishes expected errors from bugs
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
