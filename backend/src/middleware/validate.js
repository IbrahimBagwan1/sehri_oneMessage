'use strict';

const { body } = require('express-validator');
const { handleValidationErrors } = require('./otpValidation');

/**
 * Validation chain for POST /api/auth/register.
 *
 * Returns an array of express-validator checks followed by the shared
 * handleValidationErrors middleware. All validation errors are collected
 * and returned together using the same error shape as the rest of the API
 * (via the shared response utility inside handleValidationErrors).
 *
 * Usage in routes:
 *   router.post('/register', validateRegistration, registerUser);
 */
const validateRegistration = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required'),

  body('phone')
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Phone must be a valid 10-digit Indian mobile number'),

  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),

  body('gender')
    .isIn(['male', 'female'])
    .withMessage('Gender must be male or female'),

  body('occupation')
    .isIn(['student', 'employee', 'others'])
    .withMessage('Occupation must be student, employee, or others'),

  body('location_id')
    .notEmpty()
    .withMessage('location_id is required'),

  body('address')
    .trim()
    .notEmpty()
    .withMessage('Address is required'),

  // Registration proves phone ownership one of two ways:
  //   • verification_token — issued by POST /api/auth/verify-otp, used by
  //     the dedicated phone-verification screen that now precedes this form
  //   • otp — the legacy single-screen path, still accepted so an older
  //     client build doesn't break mid-rollout
  // Exactly one is required; the controller enforces which.
  body()
    .custom((value, { req }) => {
      const hasTicket = typeof req.body?.verification_token === 'string'
        && req.body.verification_token.length > 0;
      const hasOtp = typeof req.body?.otp === 'string'
        && /^\d{4,8}$/.test(req.body.otp.trim());
      if (!hasTicket && !hasOtp) {
        throw new Error('Verify your phone number before creating an account.');
      }
      return true;
    }),

  handleValidationErrors,
];

module.exports = validateRegistration;
