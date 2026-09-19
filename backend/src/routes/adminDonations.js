'use strict';

/**
 * Super-admin donation routes. Mounted under /api/admin/donations.
 * Every route requires role='super_admin'.
 */

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  listAll,
  verifyDonation,
  rejectDonation,
  getSummary,
} = require('../controllers/donationController');

// Route order — literal /summary before any :id routes.

// GET /api/admin/donations — paginated + filterable list.
router.get('/', verifyToken, requireRole('super_admin'), listAll);

// GET /api/admin/donations/summary — totals + counts per status.
router.get('/summary', verifyToken, requireRole('super_admin'), getSummary);

// PATCH /api/admin/donations/:id/verify — move pending → verified.
router.patch('/:id/verify', verifyToken, requireRole('super_admin'), verifyDonation);

// PATCH /api/admin/donations/:id/reject — move pending → rejected. Body: { reason? }
router.patch('/:id/reject', verifyToken, requireRole('super_admin'), rejectDonation);

module.exports = router;
