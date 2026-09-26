'use strict';

const express = require('express');
const { param, query, body } = require('express-validator');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/otpValidation');
const {
  listReports,
  resolveReport,
  liftBan,
  listBans,
} = require('../controllers/chatModerationController');

// ---------------------------------------------------------------------------
// /api/admin/chat — the moderation queue for reported chat messages.
//
// Both app stores require a working way for the operator to act on reports,
// not just collect them. These are the endpoints behind that.
//
// Access is admin OR super_admin. Admins are scoped in the controller to
// groups whose zones they administer, matching how donations and feedback
// already scope; super admins see everything. Doing the scoping in the
// controller rather than in middleware keeps it in one place — the queue
// list and every action read the same helper.
// ---------------------------------------------------------------------------

// GET /api/admin/chat/reports?status=pending|reviewed|all&page=&limit=
router.get(
  '/reports',
  verifyToken,
  requireRole('admin', 'super_admin'),
  query('status').optional().isIn(['pending', 'reviewed', 'all']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  handleValidationErrors,
  listReports
);

// PATCH /api/admin/chat/reports/:id
// Body: { delete_message?: bool, ban_user?: bool, note?: string }
// Sending neither flag marks the report reviewed with no action — a real
// outcome, and the one most reports deserve.
router.patch(
  '/reports/:id',
  verifyToken,
  requireRole('admin', 'super_admin'),
  param('id').isUUID().withMessage('id must be a UUID'),
  body('delete_message').optional().isBoolean().toBoolean(),
  body('ban_user').optional().isBoolean().toBoolean(),
  body('note').optional().isString().isLength({ max: 500 })
    .withMessage('note must be 500 characters or fewer'),
  handleValidationErrors,
  resolveReport
);

// GET /api/admin/chat/bans — everyone currently banned, so a ban is not a
// thing that quietly stays in force because nobody remembered it.
router.get('/bans', verifyToken, requireRole('admin', 'super_admin'), listBans);

// DELETE /api/admin/chat/groups/:groupId/bans/:userId?user_type=...
router.delete(
  '/groups/:groupId/bans/:userId',
  verifyToken,
  requireRole('admin', 'super_admin'),
  param('groupId').isUUID().withMessage('groupId must be a UUID'),
  param('userId').isUUID().withMessage('userId must be a UUID'),
  query('user_type').isIn(['user', 'admin', 'super_admin'])
    .withMessage('user_type must be user, admin, or super_admin'),
  handleValidationErrors,
  liftBan
);

module.exports = router;
