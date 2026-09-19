'use strict';

const express = require('express');
const { verifyToken, requireRole, requireUserAccess } = require('../middleware/auth');
const {
  listUsers,
  updateUserStatus,
  getMe,
  requestProfileEdit,
  getProfileEditRequests,
  reviewProfileEditRequest,
  deleteMyAccount,
  deleteUserById,
} = require('../controllers/userController');

const router = express.Router();

// ---------------------------------------------------------------------------
// Route order matters — Express matches top-to-bottom. Literal segments
// (/me, /profile-edit-requests, /profile-edit-requests/:id/review) must
// come BEFORE the parameterized /:id routes so 'me' or
// 'profile-edit-requests' aren't matched as user UUIDs.
//
// Safe order:
//   1. GET    /me
//   2. DELETE /me
//   3. POST   /request-profile-edit
//   4. GET    /profile-edit-requests
//   5. PATCH  /profile-edit-requests/:id/review
//   6. GET    /
//   7. PATCH  /:id/status
//   8. DELETE /:id
// ---------------------------------------------------------------------------

// GET /api/users/me — calling user's own profile with resolved zone
router.get('/me', verifyToken, requireUserAccess, getMe);

// DELETE /api/users/me — self-delete (soft, anonymized)
router.delete('/me', verifyToken, requireUserAccess, deleteMyAccount);

// POST /api/users/request-profile-edit — submit a profile change for approval
// Body: { requested_changes: { name?, gender?, occupation?, city?, location_id?, address? } }
router.post('/request-profile-edit', verifyToken, requireUserAccess, requestProfileEdit);

// GET /api/users/profile-edit-requests — admin/super_admin review queue
// ?status=pending|approved|rejected
router.get(
  '/profile-edit-requests',
  verifyToken,
  requireRole('admin', 'super_admin'),
  getProfileEditRequests
);

// PATCH /api/users/profile-edit-requests/:id/review — super_admin only
// Body: { decision: 'approved'|'rejected', admin_note? }
router.patch(
  '/profile-edit-requests/:id/review',
  verifyToken,
  requireRole('super_admin'),
  reviewProfileEditRequest
);

// GET /api/users — list (admin sees own zone; super_admin sees all)
router.get('/', verifyToken, requireRole('admin', 'super_admin'), listUsers);

// PATCH /api/users/:id/status — approve or reject a user
router.patch(
  '/:id/status',
  verifyToken,
  requireRole('admin', 'super_admin'),
  updateUserStatus
);

// DELETE /api/users/:id — super_admin admin-side delete (soft, anonymized)
router.delete('/:id', verifyToken, requireRole('super_admin'), deleteUserById);

module.exports = router;
