'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { sendBroadcast, listBroadcasts } = require('../controllers/broadcastController');

// All broadcast routes are super_admin-only. Even listing history —
// the audit trail contains the raw message body every user received,
// which admins shouldn't be able to skim.

// POST /api/broadcasts — send a push to everyone in the target audience
router.post('/', verifyToken, requireRole('super_admin'), sendBroadcast);

// GET /api/broadcasts — audit history, newest first
router.get('/', verifyToken, requireRole('super_admin'), listBroadcasts);

module.exports = router;
