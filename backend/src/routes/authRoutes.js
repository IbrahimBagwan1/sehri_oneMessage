const express = require('express');
const {
  registerUser,
  loginUser,
  switchRole,
  forgotPasswordReset,
  refreshToken,
  logout,
} = require('../controllers/authController');
const validateRegistration = require('../middleware/validate');
const { verifyToken } = require('../middleware/auth');
const limits = require('../middleware/rateLimits');

const router = express.Router();

router.post('/register', limits.signIn, validateRegistration, registerUser);
// Sign-in has two layers of brute-force protection: this per-IP backstop and
// the per-phone lockout inside the controller (services/loginThrottleService).
router.post('/login', limits.signIn, loginUser);
router.post('/forgot-password/verify-otp', limits.passwordReset, forgotPasswordReset);
router.post('/refresh-token', limits.refresh, refreshToken);
// Authenticated by the refresh token in the body, not the access token, so
// a device can still sign out cleanly after its access token has expired.
router.post('/logout', limits.refresh, logout);
router.post('/switch-role', verifyToken, switchRole);

module.exports = router;
