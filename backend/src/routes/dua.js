'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  listCategories,
  getFeatured,
  getCategory,
  triggerSync,
} = require('../controllers/duaController');

// ---------------------------------------------------------------------------
// Route order — literal (/categories, /featured, /sync) before /:categorySlug.
//
// Auth stance — Dua content is public read-only, same as the Quran routes.
// The sync trigger stays super_admin-only.
// ---------------------------------------------------------------------------

router.get('/categories', listCategories);                                          // PUBLIC
router.get('/featured',   getFeatured);                                             // PUBLIC
router.post('/sync', verifyToken, requireRole('super_admin'), triggerSync);
router.get('/:categorySlug', getCategory);                                          // PUBLIC

module.exports = router;
