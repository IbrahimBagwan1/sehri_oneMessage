'use strict';

/**
 * User-facing donation routes. Super-admin routes live in
 * ./adminDonations.js and are mounted under /api/admin/donations.
 */

const express = require('express');
const router = express.Router();
const { verifyToken, requireUserAccess } = require('../middleware/auth');
const { singleImage } = require('../middleware/upload');
const {
  submitDonation,
  getMyHistory,
} = require('../controllers/donationController');

// Route order — literal /my before any :id routes.

// POST /api/donations — multipart: field 'screenshot' + text field 'amount'.
router.post('/', verifyToken, requireUserAccess, singleImage('screenshot'), submitDonation);

// GET /api/donations/my — caller's own donations, newest first.
router.get('/my', verifyToken, requireUserAccess, getMyHistory);

module.exports = router;
