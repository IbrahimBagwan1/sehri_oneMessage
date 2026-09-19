'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { listChapters, getSurah, triggerSync } = require('../controllers/quranController');

// ---------------------------------------------------------------------------
// Route order — literal segments (/chapters, /sync) before the /:surah
// param route so Express doesn't try to parse them as surah numbers.
//
// Auth stance — Quran content is public read-only. Guests browsing the
// app without an account see the same chapters + verses as members. The
// sync trigger stays super_admin-only.
// ---------------------------------------------------------------------------

// GET /api/quran/chapters — PUBLIC — list all 114 surahs
router.get('/chapters', listChapters);

// POST /api/quran/sync — super_admin only
router.post('/sync', verifyToken, requireRole('super_admin'), triggerSync);

// GET /api/quran/:surah — PUBLIC — full surah (meta + verses)
router.get('/:surah', getSurah);

module.exports = router;
