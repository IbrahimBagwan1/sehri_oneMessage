'use strict';

/**
 * prayerService.js
 *
 * Responsible for fetching, calculating, and caching daily prayer timings.
 *
 * Strategy:
 *  1. Try AlAdhan API (https://aladhan.com/prayer-times-api) — free, no key needed.
 *  2. If the API is unreachable or returns an error, fall back to local
 *     calculation using the `adhan` npm library.
 *  3. Either way, upsert the result into the `prayer_timings` DB table so
 *     subsequent reads are just a DB lookup — no repeated API calls.
 *
 * Tahajjud calculation:
 *  Not provided by AlAdhan. We compute it as the point 2/3 through the
 *  night duration (from Isha to Fajr next day). This is the common
 *  scholarly opinion used by most Islamic apps.
 */

const axios = require('axios');
const { Coordinates, CalculationMethod, PrayerTimes, SunnahTimes } = require('adhan');
const db = require('../models');
const logger = require('../utils/logger');

const { PrayerTiming } = db;

// ---------------------------------------------------------------------------
// Location config — read from environment so the app is deployable to any
// city without touching source code. See .env.example for required keys.
// ---------------------------------------------------------------------------
const LATITUDE = parseFloat(process.env.PRAYER_LATITUDE || '12.9716');
const LONGITUDE = parseFloat(process.env.PRAYER_LONGITUDE || '77.5946');
const CITY = process.env.PRAYER_CITY || 'Bangalore';
const COUNTRY = process.env.PRAYER_COUNTRY || 'India';
const TIMEZONE = process.env.PRAYER_TIMEZONE || 'Asia/Kolkata';

// AlAdhan API — Method 1 = University of Islamic Sciences, Karachi
// (widely used in South Asia). No API key needed.
//
// Two endpoint styles, tried in this order:
//   1. /timings/{DD-MM-YYYY} with explicit latitude+longitude — preferred.
//      We already have exact coordinates configured (and the local
//      fallback uses them), so there's no reason to make AlAdhan
//      geocode a city name on every call. Fewer moving parts upstream
//      means fewer ways to fail, and it guarantees the API and the
//      fallback are computing for the SAME point on the map.
//   2. /timingsByCity — kept as a secondary attempt because it's what
//      this service used historically and is known to work for us.
const ALADHAN_BY_COORDS = 'https://api.aladhan.com/v1/timings';
const ALADHAN_BY_CITY   = 'https://api.aladhan.com/v1/timingsByCity';

// Retry policy. Prayer timings are fetched at most a couple of times a
// day, so we can afford to be patient before degrading to local maths.
const FETCH_ATTEMPTS      = 3;
const FETCH_TIMEOUT_MS    = 7000;
const RETRY_BACKOFF_MS    = [400, 1500]; // waits BETWEEN attempts 1→2, 2→3

// How long a locally-calculated row is allowed to stand before we
// re-attempt the real API. Without this, a single transient network blip
// pins the app to fallback timings for the whole day — which was the
// actual bug behind the "almanac unreachable" banner users were seeing.
const FALLBACK_RETRY_AFTER_MS = 10 * 60 * 1000; // 10 minutes

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the date string for today in the configured timezone (YYYY-MM-DD).
 * en-CA locale gives YYYY-MM-DD format natively without any slicing.
 */
const getTodayISTString = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });

/**
 * Parses a time string like "04:32 (IST)" or "04:32" and returns "HH:MM".
 * AlAdhan appends timezone info in parentheses — we strip it.
 */
const cleanTime = (timeStr) => {
  if (!timeStr) return null;
  return timeStr.split(' ')[0].trim(); // "04:32 (IST)" → "04:32"
};

/**
 * Converts a Date object to an "HH:MM" string in the configured timezone.
 * Used to format times produced by the local adhan library.
 */
const dateToISTString = (date) => {
  if (!date || isNaN(date)) return null;
  return date.toLocaleTimeString('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }); // returns "HH:MM"
};

/**
 * Calculates Tahajjud time: 2/3 of the night after Isha, before Fajr.
 *
 * Two bugs previously lived here, both now fixed:
 *
 *  1. It ignored the date being computed and always used `new Date()`.
 *     Computing tomorrow's timings therefore produced TODAY's Tahajjud.
 *     The date is now passed in explicitly.
 *
 *  2. It read the calendar date via `today.getFullYear()/getMonth()/
 *     getDate()`, which are SERVER-LOCAL. On a UTC server (i.e. almost
 *     any production host) every moment between 00:00 and 05:30 IST
 *     falls on the previous UTC day, so Tahajjud was anchored a day
 *     early for that entire window — the same IST midnight/hour
 *     normalization trap this codebase hit before in pollPhase.js and
 *     the admin dashboard. Now the date is parsed from the explicit
 *     YYYY-MM-DD string, so no local-time reads happen at all.
 *
 * @param {string} dateStr   - "YYYY-MM-DD" the Isha belongs to
 * @param {string} ishaTime  - "HH:MM" of that night's Isha
 * @param {string} fajrTime  - "HH:MM" of the FOLLOWING morning's Fajr
 * @returns {string|null}    - "HH:MM" IST of Tahajjud, or null on error
 */
const calculateTahajjud = (dateStr, ishaTime, fajrTime) => {
  try {
    if (!dateStr || !ishaTime || !fajrTime) return null;

    const [year, month, day] = dateStr.split('-').map(Number);
    const [ishaH, ishaM] = ishaTime.split(':').map(Number);
    const [fajrH, fajrM] = fajrTime.split(':').map(Number);
    if ([year, month, day, ishaH, ishaM, fajrH, fajrM].some((n) => !Number.isFinite(n))) {
      return null;
    }

    // IST wall clock → absolute instant. IST is a fixed +05:30 with no
    // DST, so subtracting the offset from a UTC-constructed date is exact.
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istInstant = (y, mo, d, h, mi) =>
      new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS);

    const ishaDate = istInstant(year, month, day, ishaH, ishaM);
    // Fajr belongs to the NEXT calendar day. Date.UTC normalises a
    // day overflow (e.g. Sept 31 → Oct 1) on its own.
    const fajrDate = istInstant(year, month, day + 1, fajrH, fajrM);

    const nightDurationMs = fajrDate.getTime() - ishaDate.getTime();
    if (nightDurationMs <= 0) return null;

    // 2/3 of the way through the night, measured from Isha.
    const tahajjudDate = new Date(ishaDate.getTime() + (nightDurationMs * 2) / 3);
    return dateToISTString(tahajjudDate);
  } catch (err) {
    logger.error(`calculateTahajjud error: ${err.message}`);
    return null;
  }
};

/**
 * Hijri date for a given Gregorian YYYY-MM-DD, formatted to match the
 * shape AlAdhan returns ("10 Rabiʻ II 1448").
 *
 * Exists so a locally-calculated day isn't visibly degraded: the home
 * screen shows the Hijri date in its hero, and it used to vanish
 * entirely whenever we fell back. Uses the Umm al-Qura calendar via
 * Intl, which matches AlAdhan's Hijri output for our region.
 */
const hijriDateFor = (dateStr) => {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    // Midday avoids any edge where a timezone shift lands on the
    // neighbouring Gregorian day.
    const instant = new Date(Date.UTC(y, m - 1, d, 12, 0));
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      timeZone: TIMEZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(instant);

    const get = (type) => parts.find((p) => p.type === type)?.value;
    const day = get('day');
    const month = get('month');
    const year = get('year');
    if (!day || !month || !year) return null;
    // Intl yields "1448 AH" for the year — strip the era suffix so the
    // string matches AlAdhan's "10 Rabiʻ II 1448".
    return `${day} ${month} ${String(year).replace(/\s*AH\s*$/i, '')}`;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Primary: Fetch from AlAdhan API
// ---------------------------------------------------------------------------

/**
 * Fetches prayer timings from AlAdhan API for a given date string (YYYY-MM-DD).
 * Returns a structured object ready for DB insertion, or throws on failure.
 */
const shapeAlAdhanResponse = (dateStr, payload) => {
  const { timings, date } = payload;

  // Clean all time strings (strip timezone suffix AlAdhan appends)
  const cleanedTimings = {};
  for (const [key, val] of Object.entries(timings)) {
    cleanedTimings[key] = cleanTime(val);
  }

  const tahajjud = calculateTahajjud(dateStr, cleanedTimings.Isha, cleanedTimings.Fajr);

  // Hijri date from AlAdhan response
  const hijri = date?.hijri;
  const dateHijri = hijri
    ? `${hijri.day} ${hijri.month?.en} ${hijri.year}`
    : hijriDateFor(dateStr);

  return {
    date: dateStr,
    city: CITY,
    country: COUNTRY,
    timings: cleanedTimings,
    tahajjud_time: tahajjud,
    imsak_time: cleanedTimings.Imsak || null,
    date_hijri: dateHijri,
    is_from_api: true,
  };
};

/** One AlAdhan call against the coordinate endpoint (preferred). */
const fetchByCoordinates = async (dateStr) => {
  const [year, month, day] = dateStr.split('-');
  const { data } = await axios.get(`${ALADHAN_BY_COORDS}/${day}-${month}-${year}`, {
    params: {
      latitude: LATITUDE,
      longitude: LONGITUDE,
      method: 1, // University of Islamic Sciences, Karachi
    },
    timeout: FETCH_TIMEOUT_MS,
  });
  if (data.code !== 200 || !data.data) {
    throw new Error(`AlAdhan (coords) returned code ${data.code}`);
  }
  return shapeAlAdhanResponse(dateStr, data.data);
};

/** One AlAdhan call against the city endpoint (secondary). */
const fetchByCity = async (dateStr) => {
  const [year, month, day] = dateStr.split('-');
  const { data } = await axios.get(ALADHAN_BY_CITY, {
    params: {
      city: CITY,
      country: COUNTRY,
      method: 1,
      date: `${day}-${month}-${year}`, // AlAdhan expects DD-MM-YYYY
    },
    timeout: FETCH_TIMEOUT_MS,
  });
  if (data.code !== 200 || !data.data) {
    throw new Error(`AlAdhan (city) returned code ${data.code}`);
  }
  return shapeAlAdhanResponse(dateStr, data.data);
};

/**
 * Fetch from AlAdhan with retries and backoff.
 *
 * Falling back to local maths on a SINGLE transient failure was the
 * original sin here — a one-second DNS hiccup produced a whole day of
 * "calculated locally" timings. We now make several attempts, and
 * alternate endpoint style so a fault isolated to AlAdhan's city
 * geocoder (or to one of their edges) doesn't take us down.
 *
 * Throws only when every attempt has failed.
 */
const fetchFromAlAdhan = async (dateStr) => {
  // Alternate strategies across attempts: coords, city, coords.
  const strategies = [fetchByCoordinates, fetchByCity, fetchByCoordinates];
  let lastErr;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    const strategy = strategies[attempt % strategies.length];
    try {
      const result = await strategy(dateStr);
      if (attempt > 0) {
        logger.info(`[prayerService] AlAdhan recovered on attempt ${attempt + 1} for ${dateStr}`);
      }
      return result;
    } catch (err) {
      lastErr = err;
      logger.warn(
        `[prayerService] AlAdhan attempt ${attempt + 1}/${FETCH_ATTEMPTS} failed for ${dateStr}: ${err.message}`
      );
      const backoff = RETRY_BACKOFF_MS[attempt];
      if (backoff) await sleep(backoff);
    }
  }

  throw lastErr || new Error('AlAdhan unreachable');
};

// ---------------------------------------------------------------------------
// Fallback: Calculate locally using adhan library
// ---------------------------------------------------------------------------

/**
 * Calculates prayer timings locally using the `adhan` library.
 * Used when AlAdhan API is unreachable.
 * Returns the same structured object shape as fetchFromAlAdhan().
 */
const calculateLocally = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);

  const coords = new Coordinates(LATITUDE, LONGITUDE);
  const params = CalculationMethod.Karachi(); // matches AlAdhan method 1

  // adhan month is 0-indexed
  const prayerDate = new Date(year, month - 1, day);
  const prayers = new PrayerTimes(coords, prayerDate, params);
  const sunnah = new SunnahTimes(prayers);

  const fajr = dateToISTString(prayers.fajr);

  // adhan has no Imsak concept. AlAdhan's method-1 Imsak is Fajr minus
  // 10 minutes (verified against our own stored API rows: Fajr 04:58 →
  // Imsak 04:48). Deriving it keeps the Sehri-end marker present on a
  // fallback day instead of silently vanishing from the ribbon — which
  // matters a great deal in Ramadan for a Sehri coordination app.
  const IMSAK_OFFSET_MIN = 10;
  const imsak = fajr
    ? dateToISTString(new Date(prayers.fajr.getTime() - IMSAK_OFFSET_MIN * 60 * 1000))
    : null;

  const timings = {
    Fajr: fajr,
    Sunrise: dateToISTString(prayers.sunrise),
    Dhuhr: dateToISTString(prayers.dhuhr),
    Asr: dateToISTString(prayers.asr),
    Maghrib: dateToISTString(prayers.maghrib),
    Isha: dateToISTString(prayers.isha),
    Imsak: imsak,
    Midnight: dateToISTString(sunnah.middleOfTheNight),
  };

  const tahajjud = calculateTahajjud(dateStr, timings.Isha, timings.Fajr);

  return {
    date: dateStr,
    city: CITY,
    country: COUNTRY,
    timings,
    tahajjud_time: tahajjud,
    imsak_time: imsak,
    // Derived locally via Intl's Umm al-Qura calendar rather than left
    // null, so the home hero keeps its Hijri line on a fallback day.
    date_hijri: hijriDateFor(dateStr),
    is_from_api: false,
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetches (or retrieves from cache) prayer timings for the given date.
 *
 * @param {string} dateStr - YYYY-MM-DD. Defaults to today in configured timezone.
 * @param {boolean} forceRefresh - If true, skips DB cache and re-fetches.
 * @returns {object} The PrayerTiming model instance.
 */
const getPrayerTimings = async (dateStr = null, forceRefresh = false) => {
  const date = dateStr || getTodayISTString();

  const cached = await PrayerTiming.findOne({ where: { date } });

  // 1. Decide whether the cached row is good enough to serve as-is.
  //
  //    THE BUG THIS FIXES: the old code returned ANY cached row. So the
  //    first request of the day that happened to hit a network blip
  //    wrote a locally-calculated row, and every request afterwards was
  //    served that same degraded row — for the rest of the day, with no
  //    further API attempt. That is what put "Calculated locally — the
  //    online almanac was unreachable" on users' home screens even
  //    though AlAdhan was perfectly healthy seconds later.
  //
  //    Now: an authentic row is always served. A fallback row is served
  //    only until FALLBACK_RETRY_AFTER_MS has elapsed, after which the
  //    next read quietly re-attempts the real API. The cooldown exists
  //    so a genuine outage doesn't mean an upstream call on every single
  //    request.
  if (cached && !forceRefresh) {
    if (cached.is_from_api) return cached;

    const ageMs = Date.now() - new Date(cached.updatedAt || cached.createdAt || 0).getTime();
    if (ageMs < FALLBACK_RETRY_AFTER_MS) return cached;

    logger.info(
      `[prayerService] Cached ${date} is a local fallback and is ${Math.round(ageMs / 60000)}m old — re-attempting AlAdhan`
    );
  }

  // 2. Try AlAdhan (with retries), and only degrade as a last resort.
  let timingData;
  try {
    timingData = await fetchFromAlAdhan(date);
    logger.info(`[prayerService] Fetched authentic timings from AlAdhan for ${date}`);
  } catch (err) {
    logger.warn(
      `[prayerService] AlAdhan unreachable after ${FETCH_ATTEMPTS} attempts for ${date} (${err.message}) — using local calculation`
    );
    timingData = calculateLocally(date);

    // Keep the row's timestamp moving even when the data is unchanged,
    // so the retry cooldown restarts rather than re-attempting on every
    // request during a sustained outage.
    if (cached && !cached.is_from_api) {
      await cached.update({ ...timingData, updatedAt: new Date() });
      return cached;
    }
  }

  // 3. Upsert — update existing row or create a new one
  const [record] = await PrayerTiming.upsert(timingData, {
    returning: true,
  });

  return record;
};

/** Tomorrow's date as YYYY-MM-DD in the configured timezone. */
const getTomorrowISTString = () => {
  const [y, m, d] = getTodayISTString().split('-').map(Number);
  // Date.UTC normalises month/year rollover for us.
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/**
 * Fetch and cache tomorrow's timings.
 *
 * NOTE: the previous comment here claimed this was "called by the 12:05
 * AM cron job". There is no cron job — this project has no scheduler
 * (no node-cron dependency, nothing registered in server.js), so this
 * function was dead code. Timings are fetched lazily instead, on the
 * first request for a date that isn't cached.
 *
 * It is now genuinely used, by warmTomorrow() below.
 */
const fetchTomorrowTimings = async () => getPrayerTimings(getTomorrowISTString(), true);

// Guards the opportunistic warm so it runs at most once per process per
// date, rather than on every single request.
let warmedFor = null;

/**
 * Opportunistically pre-fetch tomorrow's timings in the background.
 *
 * Without a scheduler, the first person to open the app after midnight
 * pays for a live AlAdhan round-trip — and if that one call happens to
 * fail, they're the one who poisons the day's cache. Warming tomorrow
 * while today is already being served removes that cold-start entirely,
 * with no new infrastructure.
 *
 * Fire-and-forget: never throws, never blocks the caller's response.
 */
const warmTomorrow = () => {
  const tomorrow = getTomorrowISTString();
  if (warmedFor === tomorrow) return;
  warmedFor = tomorrow;

  (async () => {
    try {
      const existing = await PrayerTiming.findOne({ where: { date: tomorrow } });
      if (existing && existing.is_from_api) return; // already good
      await getPrayerTimings(tomorrow, true);
      logger.info(`[prayerService] Pre-warmed timings for ${tomorrow}`);
    } catch (err) {
      // Reset so a later request can try again.
      warmedFor = null;
      logger.warn(`[prayerService] Pre-warm for ${tomorrow} failed: ${err.message}`);
    }
  })();
};

module.exports = {
  getPrayerTimings,
  fetchTomorrowTimings,
  warmTomorrow,
  getTodayISTString,
  getTomorrowISTString,
  // Exported for the accuracy self-check in prayerController's
  // diagnostics response — not used elsewhere.
  calculateLocally,
};
