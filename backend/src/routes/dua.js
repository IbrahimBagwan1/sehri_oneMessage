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
// Route order — literal (/categories, /featured, /sync) before /:categorySlug
// so a slug named "categories" or "featured" can never collide.
//
// Safe order:
//   1. GET  /categories
//   2. GET  /featured
//   3. POST /sync
//   4. GET  /:categorySlug
// ---------------------------------------------------------------------------

router.get('/categories', verifyToken, listCategories);
router.get('/featured', verifyToken, getFeatured);
router.post('/sync', verifyToken, requireRole('super_admin'), triggerSync);
router.get('/:categorySlug', verifyToken, getCategory);

module.exports = router;
