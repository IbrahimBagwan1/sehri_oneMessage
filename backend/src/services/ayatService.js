'use strict';

const db = require('../models');
const logger = require('../utils/logger');

const { AyatOfTheDay, QuranChapter } = db;

/**
 * ayatService.js — one verse a day, fetched once a day.
 *
 * SOURCE. islamic.app's keyless daily endpoint. THE SELECTION IS ENTIRELY
 * THEIRS: it is deterministic per UTC date and identical for every caller in
 * the world on that date. We do not choose, rank, rotate or curate it.
 *
 * Do not confuse this with the Qur'an content this app serves elsewhere:
 * `quran_chapters` / `quran_verses` hold the full corpus, synced by
 * services/islamicApiSync.js and served by quranController. Those are a
 * complete scripture corpus; this is a single third-party daily pick.
 * (A themed `topic_ayat` pool — Salah / Zakat / Sadaqah / Fasting — does not
 * exist anywhere in this codebase; if one is added later, it is a third,
 * separate thing again.)
 *
 * CACHING. At most one upstream call per UTC calendar day for the whole
 * community, however many people open the app:
 *
 *   hit   → serve our row, no network at all
 *   miss  → one caller fetches, writes, and everyone that day reads the row
 *   fail  → serve the most recent row we do have, flagged stale
 *
 * RACE SAFETY. `date` is the table's primary key, so concurrency is settled
 * by the database rather than by a lock we maintain. Two requests that miss
 * at the same instant both try to insert; one wins, the other's insert is
 * rejected as a duplicate and it re-reads the winner's row. Neither makes a
 * second upstream call. This mirrors how prayerService upserts its daily
 * timings row (PrayerTiming.upsert, keyed on date).
 */

const ENDPOINT = 'https://api.islamic.app/v1/verses/today';
const TRANSLATION = 'en-sahih-international';
const FETCH_TIMEOUT_MS = 7000;

/**
 * Trim to a sentence boundary where possible so a notification never ends
 * mid-word. Push bodies get clipped by the OS anyway; this just makes the
 * clip deliberate.
 */
const truncate = (text, max) => {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '));
  return `${(lastStop > max * 0.5 ? cut.slice(0, lastStop) : cut).trim()}…`;
};

/** Today's date in UTC as YYYY-MM-DD — the cache key. */
const todayUTC = () => new Date().toISOString().slice(0, 10);

/**
 * In-flight fetch, keyed by date.
 *
 * The primary key on `date` guarantees one ROW per day, but on its own it
 * does not guarantee one CALL: five requests that all miss the cache in the
 * same tick each reach the network before any of them has written. This
 * latch closes that window — the first miss stores its promise, the rest
 * await it, and only one request actually leaves the process.
 *
 * It is per-process, so N instances behind a load balancer can still make N
 * calls on the first request of a day. That is the honest limit of doing
 * this without a shared lock, and it is a bounded, once-a-day cost; the row
 * uniqueness still means they converge on one stored verse immediately after.
 */
let inFlight = null;
let inFlightDate = null;

/**
 * One live call to islamic.app. Throws on any non-success so the caller can
 * fall back; never returns a half-shaped object.
 */
const fetchFromUpstream = async () => {
  const url = `${ENDPOINT}?translations=${encodeURIComponent(TRANSLATION)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`islamic.app responded ${res.status}`);

    const body = await res.json();
    // Documented shape: { code, status, data: { ...verse fields... } }
    const data = body?.data;
    if (!data || typeof data !== 'object') {
      throw new Error('islamic.app response had no data object');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Normalise islamic.app's verse into the shape the app renders.
 *
 * The observed response is:
 *
 *   data.verse = {
 *     verse_key: "16:114",        // surah:ayah — the authoritative reference
 *     chapter_id: 16,
 *     verse_number: 2015,         // GLOBAL index across the whole Qur'an,
 *                                 // NOT the ayah number within the surah
 *     text_uthmani: "...",
 *     translations: [{ slug, text, resource_name, ... }],
 *   }
 *
 * `verse_number` is the trap: it looks like the ayah number and is not.
 * Surah 16 has 128 ayat, and 2015 is this verse's position in the whole
 * muṣḥaf. The ayah number is the half of `verse_key` after the colon, so
 * that is what we parse and display.
 *
 * Field lookups stay defensive because this is a free, keyless, third-party
 * endpoint whose shape we do not control: anything missing degrades to null
 * and the card omits that line, rather than rendering "undefined" to the
 * community.
 */
const shapeVerse = (payload) => {
  // The daily endpoint nests the verse; tolerate a flat object too.
  const p = (payload && payload.verse) || payload || {};

  const arabic = p.text_uthmani || p.text_imlaei || p.text || null;

  // One translation was requested, so this is an array of one. Prefer the
  // Sahih International entry explicitly in case the API ever returns more.
  let translation = null;
  let translator = null;
  const list = Array.isArray(p.translations) ? p.translations : [];
  const preferred = list.find((t) => t?.slug === TRANSLATION) || list[0] || null;
  if (preferred) {
    translation = preferred.text || null;
    translator = preferred.resource_name || null;
  } else if (typeof p.translation === 'string') {
    translation = p.translation;
  }

  // verse_key is "surah:ayah". Everything else is derived from it so the
  // three numbers can never disagree with one another.
  const key = typeof p.verse_key === 'string' ? p.verse_key : null;
  const [keySurah, keyAyah] = key ? key.split(':') : [];

  const surahNumber = Number.parseInt(keySurah, 10) || p.chapter_id || null;
  const ayahNumber  = Number.parseInt(keyAyah, 10) || null;

  return {
    arabic,
    translation,
    translator: translator || 'Sahih International',
    // Filled in by getAyatOfTheDay from our own quran_chapters table — the
    // daily endpoint does not send a surah name.
    surah_name: null,
    surah_number: surahNumber,
    ayah_number: ayahNumber,
    reference: key || (surahNumber && ayahNumber ? `${surahNumber}:${ayahNumber}` : null),
  };
};

/**
 * Add the surah's name from our own quran_chapters table.
 *
 * The daily endpoint sends only chapter_id, and we already hold all 114
 * surahs locally (synced by services/islamicApiSync.js), so there is no
 * reason to make a second upstream call for a name we have. Failing to find
 * it is not an error — the card falls back to the bare "16:114" reference.
 */
const withSurahName = async (verse) => {
  if (!verse.surah_number) return verse;
  try {
    const chapter = await QuranChapter.findByPk(verse.surah_number, {
      attributes: ['name_simple'],
    });
    if (chapter) return { ...verse, surah_name: chapter.name_simple };
  } catch (err) {
    logger.warn(`[ayat] Could not resolve surah name: ${err.message}`);
  }
  return verse;
};

/**
 * The verse for today, from cache where possible.
 *
 * @returns {Promise<{ date, verse, raw, stale, fetched_at }>}
 *          `stale` is true when we are serving an older day's verse because
 *          today's fetch failed — the client shows a quiet indicator.
 */
const getAyatOfTheDay = async () => {
  const date = todayUTC();

  // 1. Cache hit — the overwhelmingly common path, no network.
  const cached = await AyatOfTheDay.findByPk(date);
  if (cached) {
    return {
      date: cached.date,
      verse: await withSurahName(shapeVerse(cached.payload)),
      raw: cached.payload,
      stale: false,
      fetched_at: cached.fetched_at,
    };
  }

  // 2. Miss — one live call, shared by everyone who missed at the same time.
  let payload;
  try {
    if (!inFlight || inFlightDate !== date) {
      inFlightDate = date;
      inFlight = fetchFromUpstream().finally(() => {
        // Cleared either way: a failure must not latch the whole day onto a
        // rejected promise, and the fallback path below handles the miss.
        inFlight = null;
        inFlightDate = null;
      });
    }
    payload = await inFlight;
  } catch (err) {
    logger.error(`[ayat] Upstream fetch failed for ${date}: ${err.name}: ${err.message}`);

    // 2a. Another request may have won the race while we were failing.
    const raced = await AyatOfTheDay.findByPk(date);
    if (raced) {
      return {
        date: raced.date,
        verse: await withSurahName(shapeVerse(raced.payload)),
        raw: raced.payload,
        stale: false,
        fetched_at: raced.fetched_at,
      };
    }

    // 2b. Genuine outage: serve the newest verse we have rather than showing
    //     an error to everyone all day. Flagged stale so the card can say so.
    const newest = await AyatOfTheDay.findOne({ order: [['date', 'DESC']] });
    if (newest) {
      logger.warn(`[ayat] Serving ${newest.date} as a stale fallback for ${date}`);
      return {
        date: newest.date,
        verse: await withSurahName(shapeVerse(newest.payload)),
        raw: newest.payload,
        stale: true,
        fetched_at: newest.fetched_at,
      };
    }

    // 2c. Nothing cached at all — a first run during an outage. Only here
    //     does the caller get an error.
    throw err;
  }

  // 3. Store it. If a concurrent request beat us to the insert, the primary
  //    key rejects ours; we re-read theirs. Either way exactly one row and,
  //    crucially, exactly one upstream call for the day.
  try {
    await AyatOfTheDay.create({ date, payload, fetched_at: new Date() });
    logger.info(`[ayat] Cached islamic.app verse for ${date}`);

    // A new day's verse just landed. Notify once, here, inside the branch
    // that actually wrote the row — every other path through this function
    // is a cache hit or a fallback, and must stay silent.
    //
    // Deliberately quiet in tone and content: this is the one notification
    // in the app nobody asked for, so it reads as an offering rather than a
    // demand. No count, no urgency, no call to action.
    //
    // Required lazily to avoid a require cycle: notificationService pulls in
    // models, and models are loaded before services during boot.
    try {
      const notificationService = require('./notificationService');
      const verse = shapeVerse(payload);
      const named = await withSurahName(verse);
      notificationService.notifyInBackground(
        () => notificationService.sendToAll({
          title: 'Ayat of the day',
          body: named.translation
            ? truncate(named.translation, 140)
            : 'A new verse is ready to read.',
          data: { type: 'ayat_of_the_day', date, route: '/(user)' },
        }),
        'ayat of the day'
      );
    } catch (notifyErr) {
      logger.warn(`[ayat] Could not notify for ${date}: ${notifyErr.message}`);
    }
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    logger.info(`[ayat] ${date} was cached concurrently — using the stored row`);
    const winner = await AyatOfTheDay.findByPk(date);
    if (winner) {
      return {
        date: winner.date,
        verse: await withSurahName(shapeVerse(winner.payload)),
        raw: winner.payload,
        stale: false,
        fetched_at: winner.fetched_at,
      };
    }
  }

  return {
    date,
    verse: await withSurahName(shapeVerse(payload)),
    raw: payload,
    stale: false,
    fetched_at: new Date(),
  };
};

module.exports = { getAyatOfTheDay, shapeVerse, todayUTC };
