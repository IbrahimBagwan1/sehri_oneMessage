'use strict';

/**
 * duaController.js
 *
 * Serves dua content from OUR database. Sync is separate; the app never
 * calls upstream at request time.
 *
 * Endpoints:
 *   GET  /api/dua/categories        listCategories   (includes featured-today)
 *   GET  /api/dua/featured          getFeatured
 *   GET  /api/dua/:categorySlug     getCategory
 *   POST /api/dua/sync              triggerSync      (super_admin)
 *
 * "Featured today" is a deterministic pick based on the calendar day so
 * every user sees the same dua on the same day (and the pick shifts once
 * per 24h without any cron job).
 */

const db = require('../models');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');
const { syncDuas } = require('../services/islamicApiSync');

const { DuaCategory, Dua } = db;

// ---------------------------------------------------------------------------
// Helper — deterministic day-of-year in IST.
//
// Two users opening the app at 11:59 PM IST vs 00:01 AM IST see different
// featured duas — that's the point (the pick is stable within the day
// and rotates at midnight). Using IST specifically so it matches the
// user community's local sense of "today".
// ---------------------------------------------------------------------------
const getISTDayOfYear = () => {
  const nowIST = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  );
  const startOfYear = new Date(Date.UTC(nowIST.getFullYear(), 0, 1));
  const diffMs = Date.UTC(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate()) - startOfYear.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};

/**
 * Given today's IST day-of-year and the total dua count, return the
 * index of today's featured dua. Uses modulo so it wraps cleanly over
 * multi-year usage.
 */
const pickFeaturedIndex = (dayOfYear, total) => {
  if (total <= 0) return null;
  return dayOfYear % total;
};

/**
 * Fetches today's featured dua (or null if the DB is empty).
 * Uses ORDER BY (category order_index, dua order_index, id) so the
 * enumeration is stable across days.
 */
const fetchFeaturedDua = async () => {
  const total = await Dua.count();
  const idx = pickFeaturedIndex(getISTDayOfYear(), total);
  if (idx == null) return null;

  const dua = await Dua.findOne({
    include: [{ model: DuaCategory, as: 'category', attributes: ['id', 'slug', 'name'] }],
    order: [
      [{ model: DuaCategory, as: 'category' }, 'order_index', 'ASC'],
      ['order_index', 'ASC'],
      ['id', 'ASC'],
    ],
    offset: idx,
    limit: 1,
  });
  return dua;
};

// ---------------------------------------------------------------------------
// GET /api/dua/categories
// Access: any authenticated user.
//
// Returns all categories with their dua_count plus the featured-today
// dua inlined. One HTTP request populates the entire landing screen.
// ---------------------------------------------------------------------------
const listCategories = async (req, res, next) => {
  try {
    const [categories, featured] = await Promise.all([
      DuaCategory.findAll({
        order: [['order_index', 'ASC'], ['name', 'ASC']],
        attributes: ['id', 'slug', 'name', 'description', 'dua_count', 'order_index'],
      }),
      fetchFeaturedDua(),
    ]);

    return success(res, {
      statusCode: 200,
      message: 'Categories fetched',
      data: {
        total: categories.length,
        categories,
        featured_today: featured,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/dua/featured
// Access: any authenticated user.
//
// Returns just the featured dua for today. Useful as a lightweight ping
// for a dashboard widget.
// ---------------------------------------------------------------------------
const getFeatured = async (req, res, next) => {
  try {
    const featured = await fetchFeaturedDua();
    return success(res, {
      statusCode: 200,
      message: featured ? 'Featured dua fetched' : 'No duas available — run the sync first',
      data: { featured_today: featured },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/dua/:categorySlug
// Access: any authenticated user.
//
// Returns the category and all duas within it, ordered.
// ---------------------------------------------------------------------------
const getCategory = async (req, res, next) => {
  try {
    const { categorySlug } = req.params;
    if (!categorySlug || typeof categorySlug !== 'string') {
      return error(res, { statusCode: 400, message: 'categorySlug is required' });
    }

    const category = await DuaCategory.findOne({ where: { slug: categorySlug } });
    if (!category) {
      return error(res, { statusCode: 404, message: `Category '${categorySlug}' not found` });
    }

    const duas = await Dua.findAll({
      where: { category_id: category.id },
      order: [['order_index', 'ASC'], ['created_at', 'ASC']],
      attributes: [
        'id',
        'slug',
        'name',
        'arabic_text',
        'transliteration',
        'translation',
        'source',
        'order_index',
      ],
    });

    return success(res, {
      statusCode: 200,
      message: 'Category fetched',
      data: { category, duas },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/dua/sync
// Access: super_admin only. Fire-and-forget background job.
// ---------------------------------------------------------------------------
const triggerSync = async (req, res, next) => {
  try {
    syncDuas()
      .then((result) => logger.info(`[dua/sync] done: ${JSON.stringify(result)}`))
      .catch((err) => logger.error(`[dua/sync] failed: ${err.stack || err.message}`));

    return success(res, {
      statusCode: 202,
      message: 'Dua sync started. Check server logs for progress.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { listCategories, getFeatured, getCategory, triggerSync };
