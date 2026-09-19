'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole, requireUserAccess } = require('../middleware/auth');
const {
  submitDonation,
  getMyHistory,
  getAllDonations,
  getDonationSummary,
  updateStatus,
} = require('../controllers/donationController');

// ---------------------------------------------------------------------------
// Route order — literal segments (/submit, /history, /all, /summary) must
// come before parameterized /:id/status to avoid Express matching them as
// donation UUIDs.
//
// Safe order:
//   1. POST  /submit
//   2. GET   /history
//   3. GET   /all
//   4. GET   /summary
//   5. PATCH /:id/status
// ---------------------------------------------------------------------------

// POST /api/donations/submit — resident records a donation
// Body: { amount: number, note?: string }
router.post('/submit', verifyToken, requireUserAccess, submitDonation);

// GET /api/donations/history — calling user's own donation history
// ?page=1&limit=20&status=pending|verified|rejected
router.get('/history', verifyToken, requireUserAccess, getMyHistory);

// GET /api/donations/all — admin/super_admin list (admin zone-scoped)
// ?page=1&limit=20&status=pending|verified|rejected
router.get('/all', verifyToken, requireRole('admin', 'super_admin'), getAllDonations);

// GET /api/donations/summary — totals for the admin dashboard
// ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/summary', verifyToken, requireRole('admin', 'super_admin'), getDonationSummary);

// PATCH /api/donations/:id/status — verify or reject
// Body: { status: 'verified' | 'rejected' }
router.patch(
  '/:id/status',
  verifyToken,
  requireRole('admin', 'super_admin'),
  updateStatus
);

module.exports = router;
