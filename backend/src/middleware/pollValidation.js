'use strict';

/**
 * pollValidation.js — express-validator chains for all poll POST/PATCH routes.
 *
 * Pattern matches the existing validate.js (registration) convention:
 *   - Each export is an array: [...checks, handleValidationErrors]
 *   - Plug directly into the route as a single spread or array argument
 *   - handleValidationErrors returns 422 + field-level error list on failure
 *
 * After these run, controllers can assume bodies are structurally valid.
 * Business-logic guards (window open, duplicate vote, etc.) stay in controllers.
 */

const { body, param } = require('express-validator');
const { handleValidationErrors } = require('./otpValidation');

// ---------------------------------------------------------------------------
// POST /api/polls/:id/respond
// Body: { response: 'yes' | 'no' }
// ---------------------------------------------------------------------------
const validateVote = [
  param('id')
    .isUUID(4)
    .withMessage('Poll id must be a valid UUID'),

  body('response')
    .notEmpty()
    .withMessage('response is required')
    .isIn(['yes', 'no'])
    .withMessage("response must be 'yes' or 'no'"),

  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// POST /api/polls/:id/special-case
// Body: { type: 'want' | 'dont_want' }
// ---------------------------------------------------------------------------
const validateSpecialCase = [
  param('id')
    .isUUID(4)
    .withMessage('Poll id must be a valid UUID'),

  body('type')
    .notEmpty()
    .withMessage('type is required')
    .isIn(['want', 'dont_want'])
    .withMessage("type must be 'want' or 'dont_want'"),

  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// POST /api/polls/special-cases/allot
// Body: { decisions: [{ response_id: uuid, decision: 'approved'|'rejected' }] }
// ---------------------------------------------------------------------------
const validateAllot = [
  body('decisions')
    .isArray({ min: 1 })
    .withMessage('decisions must be a non-empty array'),

  body('decisions.*.response_id')
    .isUUID(4)
    .withMessage('Each response_id must be a valid UUID'),

  body('decisions.*.decision')
    .isIn(['approved', 'rejected'])
    .withMessage("Each decision must be 'approved' or 'rejected'"),

  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// PATCH /api/polls/active/toggle
// Body: { is_active: true | false }
// ---------------------------------------------------------------------------
const validateToggle = [
  body('is_active')
    .exists({ checkNull: true })
    .withMessage('is_active is required')
    .isBoolean({ strict: true })
    .withMessage('is_active must be a boolean (true or false)'),

  handleValidationErrors,
];

module.exports = {
  validateVote,
  validateSpecialCase,
  validateAllot,
  validateToggle,
};
