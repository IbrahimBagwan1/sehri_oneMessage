'use strict';

/**
 * islamicApiSync.js — pulls Quran content from api.quran.com (v4, free
 * and unauthenticated) and seeds Dua content from a bundled JSON file.
 *
 * Design contract:
 *   • The app is served from OUR database, never live from upstream.
 *     Every user-facing endpoint reads from the DB; this module is the
 *     only code that talks to the external API OR the seed file.
 *   • Idempotent — safe to re-run to refresh translations without
 *     duplicating rows. Uses model upserts keyed on natural ids
 *     (chapter number, (chapter, verse_number), category slug, dua slug).
 *   • Rate-limited — sleeps briefly between Quran API calls.
 *   • Configurable — QURAN_API_BASE_URL lets you point at any
 *     quran.com-v4-compatible mirror without a code change.
 *
 * Public helpers:
 *   • syncQuran({ onProgress })       — full 114-surah sync via HTTP
 *   • syncDuasFromSeed({ onProgress }) — seed the dua tables from the
 *                                        bundled JSON (works offline)
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');
const db = require('../models');
const logger = require('../utils/logger');

const { QuranChapter, QuranVerse, DuaCategory, Dua } = db;

// api.quran.com v4 — free, keyless, well-maintained. Endpoints:
//   GET /chapters?language=en
//   GET /verses/by_chapter/{id}?translations=131&fields=text_uthmani&per_page=286
const QURAN_BASE_URL =
  process.env.QURAN_API_BASE_URL ||
  process.env.ISLAMIC_API_BASE_URL ||        // backwards-compat
  'https://api.quran.com/api/v4';

// English (Sahih International) — quran.com v4 translation resource id.
const TRANSLATION_ID = process.env.ISLAMIC_API_TRANSLATION_ID || '131';

// Politeness delay between upstream calls (ms).
const REQUEST_DELAY_MS = Number.parseInt(process.env.ISLAMIC_API_DELAY_MS, 10) || 200;
const REQUEST_TIMEOUT_MS = 20000;

// Where the bundled duas live. Absolute path so callers from any cwd work.
const DUA_SEED_PATH = path.join(__dirname, '..', 'data', 'duas-seed.json');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const http = async (path, params = {}) => {
  const url = `${QURAN_BASE_URL}${path}`;
  try {
    const { data } = await axios.get(url, { params, timeout: REQUEST_TIMEOUT_MS });
    return data;
  } catch (err) {
    logger.warn(`[quran-sync] GET ${url} failed: ${err.message}`);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Quran normalizers — pin to quran.com v4 shape.
// ---------------------------------------------------------------------------
const normalizeChapter = (raw) => ({
  id: Number(raw.id),
  name_arabic:      raw.name_arabic     || '',
  name_simple:      raw.name_simple     || raw.name_complex || '',
  translated_name:  raw.translated_name?.name || null,
  revelation_place: (raw.revelation_place || 'meccan').toLowerCase() === 'medinan' ? 'medinan' : 'meccan',
  verses_count:     Number(raw.verses_count || 0),
  bismillah_pre:    raw.bismillah_pre !== undefined ? Boolean(raw.bismillah_pre) : true,
});

const normalizeVerse = (chapterId, raw) => {
  // quran.com puts translations in `translations: [{ text, resource_name }]`.
  // Strip inline HTML footnote tags upstream sometimes injects (<sup>…</sup>).
  let translationText = null;
  let translationSource = null;
  if (Array.isArray(raw.translations) && raw.translations.length > 0) {
    translationText = String(raw.translations[0].text || '').replace(/<[^>]+>/g, '').trim();
    translationSource = raw.translations[0].resource_name || null;
  }
  return {
    chapter_id:         chapterId,
    verse_number:       Number(raw.verse_number || 0),
    verse_key:          raw.verse_key || `${chapterId}:${raw.verse_number || ''}`,
    text_uthmani:       raw.text_uthmani || '',
    translation_text:   translationText,
    translation_source: translationSource,
  };
};

// ---------------------------------------------------------------------------
// Public: syncQuran
// ---------------------------------------------------------------------------
const syncQuran = async ({ onProgress } = {}) => {
  logger.info(`[quran-sync] Starting from ${QURAN_BASE_URL}`);

  // 1. Chapters -------------------------------------------------------------
  const chaptersData = await http('/chapters', { language: 'en' });
  const chaptersRaw = Array.isArray(chaptersData?.chapters)
    ? chaptersData.chapters
    : Array.isArray(chaptersData)
      ? chaptersData
      : [];

  if (chaptersRaw.length === 0) {
    throw new Error('Upstream returned no chapters — check QURAN_API_BASE_URL and endpoint shape.');
  }

  const chapters = chaptersRaw.map(normalizeChapter).filter((c) => c.id >= 1 && c.id <= 114);
  logger.info(`[quran-sync] Fetched ${chapters.length} chapter records`);

  await QuranChapter.bulkCreate(chapters, {
    updateOnDuplicate: [
      'name_arabic', 'name_simple', 'translated_name',
      'revelation_place', 'verses_count', 'bismillah_pre',
    ],
  });

  // 2. Verses per chapter ---------------------------------------------------
  let totalVerses = 0;
  for (const chapter of chapters) {
    await sleep(REQUEST_DELAY_MS);

    const versesData = await http(`/verses/by_chapter/${chapter.id}`, {
      language: 'en',
      words: 'false',
      translations: TRANSLATION_ID,
      fields: 'text_uthmani,verse_key,verse_number',
      // per_page must be a number; sending `all` no longer works in v4.
      per_page: Math.max(chapter.verses_count, 1),
    });

    const versesRaw = Array.isArray(versesData?.verses) ? versesData.verses : [];
    if (versesRaw.length === 0) {
      logger.warn(`[quran-sync] Chapter ${chapter.id} returned no verses`);
      onProgress?.({ chapter: chapter.id, verses: 0 });
      continue;
    }

    const verses = versesRaw
      .map((v) => normalizeVerse(chapter.id, v))
      .filter((v) => v.verse_number > 0 && v.text_uthmani);

    await QuranVerse.bulkCreate(verses, {
      updateOnDuplicate: ['verse_key', 'text_uthmani', 'translation_text', 'translation_source'],
    });

    totalVerses += verses.length;
    onProgress?.({ chapter: chapter.id, verses: verses.length });
    logger.info(`[quran-sync] Chapter ${chapter.id} synced: ${verses.length} verses`);
  }

  logger.info(`[quran-sync] Done: ${chapters.length} chapters, ${totalVerses} verses`);
  return { chapters: chapters.length, verses: totalVerses };
};

// ---------------------------------------------------------------------------
// Public: syncDuasFromSeed
//
// The dua library is small and stable — bundling it as JSON gives us
// three wins over a third-party API:
//   1. Works offline / during upstream outages.
//   2. No risk of translation churn on a live shrine day.
//   3. Additions are a two-line change to a version-controlled file.
//
// Extending the library: append entries to backend/src/data/duas-seed.json
// following the existing shape and re-run `node scripts/sync-duas.js`.
// ---------------------------------------------------------------------------
const syncDuasFromSeed = async ({ onProgress } = {}) => {
  logger.info(`[dua-sync] Reading seed at ${DUA_SEED_PATH}`);

  if (!fs.existsSync(DUA_SEED_PATH)) {
    throw new Error(`Seed file not found at ${DUA_SEED_PATH}`);
  }

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(DUA_SEED_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Seed file is not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(seed) || seed.length === 0) {
    throw new Error('Seed file must be a non-empty array of categories.');
  }

  let totalDuas = 0;

  for (let i = 0; i < seed.length; i += 1) {
    const raw = seed[i];
    if (!raw.slug || !raw.name) {
      logger.warn(`[dua-sync] Skipping category at index ${i} — missing slug or name`);
      continue;
    }

    const [category] = await DuaCategory.upsert(
      {
        slug: raw.slug,
        name: raw.name,
        description: raw.description || null,
        order_index: Number.isFinite(raw.order_index) ? raw.order_index : i,
      },
      { returning: true }
    );

    const duas = Array.isArray(raw.duas)
      ? raw.duas
          .filter((d) => d && d.slug && d.arabic_text)
          .map((d, idx) => ({
            category_id:     category.id,
            slug:            d.slug,
            name:            d.name || `Dua ${idx + 1}`,
            arabic_text:     d.arabic_text,
            transliteration: d.transliteration || null,
            translation:     d.translation || null,
            source:          d.source || null,
            order_index:     Number.isFinite(d.order_index) ? d.order_index : idx,
          }))
      : [];

    if (duas.length > 0) {
      await Dua.bulkCreate(duas, {
        updateOnDuplicate: [
          'category_id', 'name', 'arabic_text', 'transliteration',
          'translation', 'source', 'order_index',
        ],
      });
    }

    // Keep dua_count fresh so the categories list doesn't need a JOIN.
    await category.update({ dua_count: duas.length });

    totalDuas += duas.length;
    onProgress?.({ category: raw.slug, duas: duas.length });
    logger.info(`[dua-sync] ${raw.slug} → ${duas.length} duas`);
  }

  logger.info(`[dua-sync] Done: ${seed.length} categories, ${totalDuas} duas`);
  return { categories: seed.length, duas: totalDuas };
};

module.exports = {
  syncQuran,
  syncDuasFromSeed,
  // Back-compat alias — older code may still import `syncDuas`.
  syncDuas: syncDuasFromSeed,
  QURAN_BASE_URL,
};
