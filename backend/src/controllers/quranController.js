'use strict';

/**
 * quranController.js
 *
 * Serves Quran content from OUR database. No upstream calls happen at
 * request time — content is populated by the sync script/endpoint.
 *
 * Endpoints:
 *   GET  /api/quran/chapters          listChapters
 *   GET  /api/quran/:surah            getSurah
 *   POST /api/quran/sync              triggerSync   (super_admin)
 */

const db = require('../models');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');
const { syncQuran } = require('../services/islamicApiSync');

const { QuranChapter, QuranVerse } = db;

// ---------------------------------------------------------------------------
// GET /api/quran/chapters
// Access: any authenticated user (Quran browsing is a per-user feature).
//
// Returns all 114 surahs with the metadata needed for the list screen:
//   id, name_arabic, name_simple, translated_name, revelation_place,
//   verses_count, bismillah_pre.
//
// Sorted by id ascending — the canonical surah order.
// ---------------------------------------------------------------------------
const listChapters = async (req, res, next) => {
  try {
    const chapters = await QuranChapter.findAll({
      order: [['id', 'ASC']],
      attributes: [
        'id',
        'name_arabic',
        'name_simple',
        'translated_name',
        'revelation_place',
        'verses_count',
        'bismillah_pre',
      ],
    });

    return success(res, {
      statusCode: 200,
      message: 'Chapters fetched',
      data: { total: chapters.length, chapters },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/quran/:surah
// Access: any authenticated user.
//
// Param: surah — integer 1..114.
// Returns the chapter meta + every verse (Arabic + translation) in order.
// A single surah is small enough (≤ ~286 verses for Al-Baqarah) that we
// never need to paginate the reader.
// ---------------------------------------------------------------------------
const getSurah = async (req, res, next) => {
  try {
    const surahId = Number.parseInt(req.params.surah, 10);
    if (!Number.isInteger(surahId) || surahId < 1 || surahId > 114) {
      return error(res, {
        statusCode: 400,
        message: 'surah must be an integer between 1 and 114',
      });
    }

    const chapter = await QuranChapter.findByPk(surahId);
    if (!chapter) {
      return error(res, {
        statusCode: 404,
        message: `Surah ${surahId} not found — has the Quran sync been run?`,
      });
    }

    const verses = await QuranVerse.findAll({
      where: { chapter_id: surahId },
      order: [['verse_number', 'ASC']],
      attributes: [
        'verse_number',
        'verse_key',
        'text_uthmani',
        'translation_text',
        'translation_source',
      ],
    });

    return success(res, {
      statusCode: 200,
      message: 'Surah fetched',
      data: {
        chapter,
        verses,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/quran/sync
// Access: super_admin only.
//
// Kicks off the upstream sync in the background and returns 202 immediately.
// The sync takes ~30–60s (114 surahs, ~200ms delay each) so blocking the
// HTTP request would time out most clients.
// ---------------------------------------------------------------------------
const triggerSync = async (req, res, next) => {
  try {
    // Fire-and-forget — the promise runs on the event loop after we respond.
    syncQuran()
      .then((result) => logger.info(`[quran/sync] done: ${JSON.stringify(result)}`))
      .catch((err) => logger.error(`[quran/sync] failed: ${err.stack || err.message}`));

    return success(res, {
      statusCode: 202,
      message: 'Quran sync started. Check server logs for progress.',
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { listChapters, getSurah, triggerSync };
