/**
 * Standardized API response helpers.
 * Every endpoint in this project should respond through these,
 * so the mobile team always receives a predictable shape.
 */

const success = (res, { statusCode = 200, message = 'Success', data = null }) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * `code` is an optional machine-readable identifier (e.g.
 * 'PHONE_ALREADY_REGISTERED') for cases where the client needs to branch
 * on WHICH error occurred rather than just display the message. String-
 * matching the human copy would break the moment that copy is reworded.
 *
 * Omitted from the body entirely when not supplied, so every existing
 * error response keeps its exact current shape.
 */
const error = (res, { statusCode = 500, message = 'Something went wrong', errors = null, code = null }) => {
  const body = { success: false, message, errors };
  if (code) body.code = code;
  return res.status(statusCode).json(body);
};

module.exports = { success, error };
