'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendBroadcast, listBroadcasts } = require('../controllers/broadcastController');

// All broadcast routes are super_admin-only. Even listing history —
// the audit trail contains the raw message body every user received,
// which admins shouldn't be able to skim.

// POST /api/broadcasts — send a push to everyone in the target audience
// A zone admin may broadcast, but only to their own zone — enforced in the
// controller from their token, not from the request body.
router.post('/', verifyToken, requireRole('admin', 'super_admin'), sendBroadcast);

// GET /api/broadcasts — audit history, newest first
// Scoped the same way: an admin sees their zone's history, a super admin all.
router.get('/', verifyToken, requireRole('admin', 'super_admin'), listBroadcasts);

module.exports = router;
