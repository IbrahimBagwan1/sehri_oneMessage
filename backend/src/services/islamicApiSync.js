'use strict';

/**
 * islamicApiSync.js — pulls Quran + Dua content from the upstream
 * Islamic API and upserts it into our local tables.
 *
 * Design contract:
 *   • The app is served from OUR database, never live from upstream.
 *     Every user-facing endpoint reads from the DB; this module is the
 *     only code that talks to the external API.
 *   • Idempotent — safe to run again to refresh translations without
 *     duplicating rows. Uses model upserts keyed on the natural id
 *     (chapter number, verse (chapter,verse_number), category slug,
 *     dua slug).
 *   • Rate-limited — sleeps briefly between requests to be polite to
 *     the upstream service.
 *   • Configurable base URL via ISLAMIC_API_BASE_URL. Defaults to the
 *     documented api.islamic.app host; swap the env var if you point
 *     at a different quran.com v4-compatible endpoint.
 *
 * Public helpers:
 *   • syncQuran({ onProgress })      — full 114-surah sync
 *   • syncDuas({ onProgress })       — full dua category + entry sync
 */

const axios = require('axios');
const db = require('../models');
const logger = require('../utils/logger');

const { QuranChapter, QuranVerse, DuaCategory, Dua } = db;

const BASE_URL = process.env.ISLAMIC_API_BASE_URL || 'https://api.islamic.app/v1';

// English (Sahih International) — quran.com v4 translation resource id.
// Overridable so future translations can be pinned without a code change.
const TRANSLATION_ID = process.env.ISLAMIC_API_TRANSLATION_ID || '131';

// Politeness delay between upstream calls (ms). ~200ms keeps us well
// under any reasonable per-second rate limit while syncing 114 surahs
// in under a minute.
const REQUEST_DELAY_MS = Number.parseInt(process.env.ISLAMIC_API_DELAY_MS, 10) || 200;

const REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Thin GET helper. Throws on non-2xx (axios default) so the caller can
 * rely on `data` being present. All upstream URLs pass through here so
 * timeouts + logging are consistent.
 */
const http = async (path, params = {}) => {
  const url = `${BASE_URL}${path}`;
  try {
    const { data } = await axios.get(url, { params, timeout: REQUEST_TIMEOUT_MS });
    return data;
  } catch (err) {
    logger.warn(`[islamicApiSync] GET ${url} failed: ${err.message}`);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// Chapter + verse normalizers.
//
// We keep our schema stable regardless of upstream shape changes: any
// upstream field renames only need updating here, not across controllers.
// ---------------------------------------------------------------------------

const normalizeChapter = (raw) => ({
  id: Number(raw.id),
  name_arabic: raw.name_arabic || raw.nameArabic || '',
  name_simple: raw.name_simple || raw.nameSimple || raw.name || '',
  translated_name:
    raw.translated_name?.name || raw.translatedName?.name || raw.translated_name || null,
  revelation_place:
    (raw.revelation_place || raw.revelationPlace || 'meccan').toLowerCase() === 'medinan'
      ? 'medinan'
      : 'meccan',
  verses_count: Number(raw.verses_count || raw.versesCount || 0),
  bismillah_pre: raw.bismillah_pre !== undefined ? Boolean(raw.bismillah_pre) : true,
});

const normalizeVerse = (chapterId, raw) => {
  // Translation blocks vary: some APIs return `translations: [{ text, resource_name }]`,
  // others return a single translation string. Handle both.
  let translationText = null;
  let translationSource = null;

  if (Array.isArray(raw.translations) && raw.translations.length > 0) {
    // Strip HTML footnote tags upstream sometimes injects (<sup>…</sup>).
    translationText = String(raw.translations[0].text || '').replace(/<[^>]+>/g, '').trim();
    translationSource = raw.translations[0].resource_name || raw.translations[0].resourceName || null;
  } else if (typeof raw.translation === 'string') {
    translationText = raw.translation;
  }

  return {
    chapter_id: chapterId,
    verse_number: Number(raw.verse_number || raw.verseNumber || raw.ayah || 0),
    verse_key: raw.verse_key || raw.verseKey || `${chapterId}:${raw.verse_number || raw.ayah || ''}`,
    text_uthmani: raw.text_uthmani || raw.textUthmani || raw.text || '',
    translation_text: translationText,
    translation_source: translationSource,
  };
};

// ---------------------------------------------------------------------------
// Public: syncQuran
//
// Fetches the chapter list, upserts each chapter row, then for each
// chapter fetches its verses (with English translation) and upserts them.
// The onProgress callback (optional) fires per chapter so a caller can
// stream progress to the console or a HTTP client.
// ---------------------------------------------------------------------------

const syncQuran = async ({ onProgress } = {}) => {
  logger.info(`[islamicApiSync] Starting Quran sync from ${BASE_URL}`);

  // 1. Chapters -------------------------------------------------------------
  const chaptersData = await http('/chapters', { language: 'en' });
  const chaptersRaw = Array.isArray(chaptersData?.chapters)
    ? chaptersData.chapters
    : Array.isArray(chaptersData)
      ? chaptersData
      : [];

  if (chaptersRaw.length === 0) {
    throw new Error('Upstream returned no chapters — check ISLAMIC_API_BASE_URL and endpoint shape');
  }

  const chapters = chaptersRaw.map(normalizeChapter).filter((c) => c.id >= 1 && c.id <= 114);
  logger.info(`[islamicApiSync] Fetched ${chapters.length} chapters`);

  // Bulk upsert chapters. bulkCreate with updateOnDuplicate is safe here
  // because chapter ids are stable and the columns are all writable.
  await QuranChapter.bulkCreate(chapters, {
    updateOnDuplicate: [
      'name_arabic',
      'name_simple',
      'translated_name',
      'revelation_place',
      'verses_count',
      'bismillah_pre',
    ],
  });

  // 2. Verses per chapter ---------------------------------------------------
  let totalVerses = 0;
  for (const chapter of chapters) {
    await sleep(REQUEST_DELAY_MS);

    // quran.com v4 style: /verses/by_chapter/{id}?translations=131&fields=text_uthmani
    const versesData = await http(`/verses/by_chapter/${chapter.id}`, {
      language: 'en',
      words: 'false',
      translations: TRANSLATION_ID,
      fields: 'text_uthmani,verse_key,verse_number',
      per_page: chapter.verses_count, // request the full surah in one page
    });

    const versesRaw = Array.isArray(versesData?.verses)
      ? versesData.verses
      : Array.isArray(versesData)
        ? versesData
        : [];

    if (versesRaw.length === 0) {
      logger.warn(`[islamicApiSync] Chapter ${chapter.id} returned no verses`);
      onProgress?.({ chapter: chapter.id, verses: 0 });
      continue;
    }

    const verses = versesRaw
      .map((v) => normalizeVerse(chapter.id, v))
      .filter((v) => v.verse_number > 0 && v.text_uthmani);

    // Idempotent upsert. `id` (UUID) auto-generates on first insert.
    await QuranVerse.bulkCreate(verses, {
      updateOnDuplicate: ['verse_key', 'text_uthmani', 'translation_text', 'translation_source'],
    });

    totalVerses += verses.length;
    onProgress?.({ chapter: chapter.id, verses: verses.length });
    logger.info(`[islamicApiSync] Chapter ${chapter.id} synced: ${verses.length} verses`);
  }

  logger.info(`[islamicApiSync] Quran sync complete: ${chapters.length} chapters, ${totalVerses} verses`);
  return { chapters: chapters.length, verses: totalVerses };
};

// ---------------------------------------------------------------------------
// Dua normalizers
// ---------------------------------------------------------------------------

const normalizeCategory = (raw, fallbackOrder) => ({
  slug: (raw.slug || raw.id || raw.name || '').toString().toLowerCase().replace(/\s+/g, '-'),
  name: raw.name || raw.title || raw.slug || 'Untitled',
  description: raw.description || raw.subtitle || null,
  order_index:
    raw.order !== undefined ? Number(raw.order) : (raw.order_index !== undefined ? Number(raw.order_index) : fallbackOrder),
});

const normalizeDua = (categoryId, raw, fallbackOrder) => ({
  category_id: categoryId,
  slug: (raw.slug || raw.id || `dua-${fallbackOrder}`).toString().toLowerCase().replace(/\s+/g, '-'),
  name: raw.name || raw.title || raw.category || `Dua ${fallbackOrder + 1}`,
  arabic_text: raw.arabic || raw.arabic_text || raw.text_arabic || raw.text || '',
  transliteration: raw.transliteration || raw.translit || null,
  translation: raw.translation || raw.text_english || null,
  source: raw.reference || raw.source || null,
  order_index: raw.order !== undefined ? Number(raw.order) : fallbackOrder,
});

// ---------------------------------------------------------------------------
// Public: syncDuas
//
// Fetches all categories then walks each one to pull individual duas.
// Some upstreams return duas inline with the category listing; we handle
// both shapes.
// ---------------------------------------------------------------------------

const syncDuas = async ({ onProgress } = {}) => {
  logger.info(`[islamicApiSync] Starting Dua sync from ${BASE_URL}`);

  // 1. Category list --------------------------------------------------------
  const catData = await http('/dhikr');
  const catsRaw = Array.isArray(catData?.categories)
    ? catData.categories
    : Array.isArray(catData?.dhikr)
      ? catData.dhikr
      : Array.isArray(catData)
        ? catData
        : [];

  if (catsRaw.length === 0) {
    throw new Error('Upstream returned no dua categories — check endpoint');
  }

  logger.info(`[islamicApiSync] Fetched ${catsRaw.length} dua categories`);

  let totalDuas = 0;

  for (let i = 0; i < catsRaw.length; i += 1) {
    const raw = catsRaw[i];
    const normalized = normalizeCategory(raw, i);
    if (!normalized.slug) continue;

    // Upsert the category (returns the persisted row so we get its UUID).
    const [category] = await DuaCategory.upsert(normalized, { returning: true });

    // 2. Duas within the category ------------------------------------------
    // Some upstreams provide entries inline (raw.entries); others require
    // a follow-up /dhikr/entry/{slug} call. Prefer inline data to keep
    // the sync fast.
    let duasRaw = [];
    if (Array.isArray(raw.entries)) {
      duasRaw = raw.entries;
    } else if (Array.isArray(raw.duas)) {
      duasRaw = raw.duas;
    } else {
      await sleep(REQUEST_DELAY_MS);
      try {
        const entryData = await http(`/dhikr/entry/${encodeURIComponent(normalized.slug)}`);
        if (Array.isArray(entryData?.entries)) duasRaw = entryData.entries;
        else if (Array.isArray(entryData?.duas)) duasRaw = entryData.duas;
        else if (Array.isArray(entryData)) duasRaw = entryData;
        else if (entryData && typeof entryData === 'object') duasRaw = [entryData]; // single-dua category
      } catch (err) {
        logger.warn(`[islamicApiSync] Skipping category ${normalized.slug}: ${err.message}`);
      }
    }

    const duas = duasRaw
      .map((d, idx) => normalizeDua(category.id, d, idx))
      .filter((d) => d.arabic_text);

    if (duas.length > 0) {
      await Dua.bulkCreate(duas, {
        updateOnDuplicate: [
          'category_id',
          'name',
          'arabic_text',
          'transliteration',
          'translation',
          'source',
          'order_index',
        ],
      });
    }

    // Keep dua_count fresh so the category list doesn't need a JOIN.
    await category.update({ dua_count: duas.length });

    totalDuas += duas.length;
    onProgress?.({ category: normalized.slug, duas: duas.length });
    logger.info(`[islamicApiSync] Category ${normalized.slug} synced: ${duas.length} duas`);
  }

  logger.info(`[islamicApiSync] Dua sync complete: ${catsRaw.length} categories, ${totalDuas} duas`);
  return { categories: catsRaw.length, duas: totalDuas };
};

module.exports = { syncQuran, syncDuas, BASE_URL };
