'use strict';
const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/otpValidation');
const {
  createAdmin,
  createSuperAdmin,
  listAdmins,
  deleteAdmin,
  linkUserToAdmin,
  searchUsers,
  promoteUser,
} = require('../controllers/adminController');

// All routes here are super_admin only.

// ---------------------------------------------------------------------------
// Route order — literal-segment routes first, /:id-shaped last, so nothing
// like `/users/search` gets shadowed by an id-style match.
// ---------------------------------------------------------------------------

// POST /api/admin/create-admin
// Body (Mode A — promote existing user): { user_id, zone_location_id }
// Body (Mode B — standalone):            { name, phone, password, zone_location_id }
router.post('/create-admin', verifyToken, requireRole('super_admin'), createAdmin);

// POST /api/admin/create-super-admin
// Body (Mode A — promote existing user): { user_id }
// Body (Mode B — standalone):            { name, phone, password }
router.post('/create-super-admin', verifyToken, requireRole('super_admin'), createSuperAdmin);

// GET /api/admin/list-admins
// Returns all zone admins with zone name and linked user_id.
router.get('/list-admins', verifyToken, requireRole('super_admin'), listAdmins);

// GET /api/admin/users/search?q=<name-or-phone>&page=&limit=
// Super-admin only, paginated free-text search for the promote flow.
router.get(
  '/users/search',
  verifyToken,
  requireRole('super_admin'),
  query('q').isString().trim().isLength({ min: 2 }).withMessage('q must be at least 2 characters'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
  handleValidationErrors,
  searchUsers
);

// POST /api/admin/users/:id/promote
// Super-admin only. Body: { target_role: 'admin' | 'super_admin', zone_location_id?: uuid }
router.post(
  '/users/:id/promote',
  verifyToken,
  requireRole('super_admin'),
  param('id').isUUID().withMessage('id must be a UUID'),
  body('target_role').isIn(['admin', 'super_admin']).withMessage("target_role must be 'admin' or 'super_admin'"),
  body('zone_location_id').optional({ nullable: true }).isUUID().withMessage('zone_location_id must be a UUID'),
  handleValidationErrors,
  promoteUser
);

// DELETE /api/admin/admins/:id
// Removes the admin row. Does NOT delete the linked users row.
router.delete('/admins/:id', verifyToken, requireRole('super_admin'), deleteAdmin);

// PATCH /api/admin/admins/:id/link-user
// Links or unlinks a users row to an existing admin account.
// Body: { user_id: "<uuid>" | null }
router.patch('/admins/:id/link-user', verifyToken, requireRole('super_admin'), linkUserToAdmin);

module.exports = router;
