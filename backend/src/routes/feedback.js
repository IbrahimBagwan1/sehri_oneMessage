'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole, requireUserAccess } = require('../middleware/auth');
const {
  submitFeedback,
  getMyFeedback,
  listFeedback,
  markAsRead,
} = require('../controllers/feedbackController');

// ---------------------------------------------------------------------------
// Route order — literal /my before parameterized /:id/read.
//
// Safe order:
//   1. POST  /
//   2. GET   /my
//   3. GET   /
//   4. PATCH /:id/read
// ---------------------------------------------------------------------------

// POST /api/feedback — submit feedback
// Body: { category, message }
router.post('/', verifyToken, requireUserAccess, submitFeedback);

// GET /api/feedback/my — calling user's own feedback history
router.get('/my', verifyToken, requireUserAccess, getMyFeedback);

// GET /api/feedback — admin/super_admin queue (admin zone-scoped)
// ?page=1&limit=20&category=...&is_read=true|false
router.get('/', verifyToken, requireRole('admin', 'super_admin'), listFeedback);

// PATCH /api/feedback/:id/read — mark as read
router.patch('/:id/read', verifyToken, requireRole('admin', 'super_admin'), markAsRead);

module.exports = router;
