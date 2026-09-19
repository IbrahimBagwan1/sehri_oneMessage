'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { listChapters, getSurah, triggerSync } = require('../controllers/quranController');

// ---------------------------------------------------------------------------
// Route order — literal segments (/chapters, /sync) before the /:surah
// param route so Express doesn't try to parse them as surah numbers.
//
// Safe order:
//   1. GET  /chapters
//   2. POST /sync
//   3. GET  /:surah
// ---------------------------------------------------------------------------

// GET /api/quran/chapters — list all 114 surahs
router.get('/chapters', verifyToken, listChapters);

// POST /api/quran/sync — kick off upstream sync (super_admin only)
router.post('/sync', verifyToken, requireRole('super_admin'), triggerSync);

// GET /api/quran/:surah — full surah (meta + verses)
router.get('/:surah', verifyToken, getSurah);

module.exports = router;
