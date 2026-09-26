'use strict';

/**
 * quranController.js
 *
 * Serves Quran content from OUR database. No upstream calls happen at
 * request time — content is populated by the sync script/endpoint.
 *
 * Endpoints:
 *   GET  /api/quran/chapters          listChapters
 *   GET  /api/quran/ayat-of-the-day   getAyatOfTheDay
 *   GET  /api/quran/:surah            getSurah
 *   POST /api/quran/sync              triggerSync   (super_admin)
 *
 * One exception to "no upstream calls at request time": the Ayat of the Day
 * makes at most one call to islamic.app per UTC day, on the first request of
 * that day. Every other request that day is served from our own cache table.
 * See services/ayatService.js.
 */

const db = require('../models');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');
const { syncQuran } = require('../services/islamicApiSync');
const ayatService = require('../services/ayatService');

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

// ---------------------------------------------------------------------------
// GET /api/quran/ayat-of-the-day
// Access: PUBLIC — same stance as the rest of /api/quran. A guest browsing
// without an account sees the verse too.
//
// Returns the verse islamic.app has chosen for today (UTC). THE SELECTION IS
// THEIRS, not ours: deterministic per date, the same verse for every caller
// worldwide. It is unrelated to the quran_chapters / quran_verses corpus this
// controller otherwise serves, which is the full scripture synced from
// islamicApiSync. (No `topic_ayat` themed pool exists in this codebase.)
//
// At most one upstream call happens per UTC day across the whole community;
// everything else is read from our cache. If the upstream call fails when a
// new day is due, the most recent cached verse is served with stale: true so
// the card can show a quiet indicator rather than an error.
// ---------------------------------------------------------------------------
const getAyatOfTheDay = async (req, res, next) => {
  try {
    const result = await ayatService.getAyatOfTheDay();

    return success(res, {
      statusCode: 200,
      message: result.stale
        ? "Showing the most recent verse — today's could not be fetched."
        : 'Ayat of the day fetched',
      data: {
        date: result.date,
        stale: result.stale,
        fetched_at: result.fetched_at,
        ...result.verse,
      },
    });
  } catch (err) {
    // Only reachable when the upstream is down AND we have never cached a
    // single verse — otherwise the service falls back instead of throwing.
    logger.error(`[quran] Ayat of the day unavailable: ${err.message}`);
    return error(res, {
      statusCode: 503,
      message: "Couldn't load today's verse. Please try again shortly.",
    });
  }
};

module.exports = {
  getAyatOfTheDay, listChapters, getSurah, triggerSync };
