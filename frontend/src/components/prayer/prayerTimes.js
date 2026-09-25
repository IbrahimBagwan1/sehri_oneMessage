/**
 * prayerTimes.js — pure, deterministic namaz-time logic.
 *
 * Extracted from the home screen so the maths can be reasoned about (and
 * reused by the compact widget + the full-list sheet) without dragging
 * screen state along. Nothing here touches React.
 *
 * NAMING — this is a Bangalore community app whose vocabulary is Urdu-
 * inflected throughout (Sehri, Dua, Tahajjud), so namaz names
 * follow South Asian usage: "Zuhr" (ظہر), not the Gulf-transliterated
 * "Dhuhr". NOTE that `t.Dhuhr` below is the AlAdhan API FIELD name
 * arriving from the backend — that's wire format and must not be renamed.
 *
 * TIMEZONE STRATEGY
 * Prayer times arrive as IST wall-clock strings ("05:30"). Every
 * comparison must reason in IST regardless of the device's timezone (a
 * traveller in Dubai on an IST community app is a real user). So we:
 *   1. read "now" as IST wall-clock parts via Intl.DateTimeFormat
 *      (plain toLocaleString with hour12:false returns "24" at midnight
 *      on some engines — the trap this codebase has hit before),
 *   2. anchor each time to today's IST calendar date,
 *   3. convert that IST wall clock to a real epoch instant by
 *      subtracting the fixed +05:30 offset (IST has no DST, so exact),
 *   4. compare with .getTime(), which is device-timezone-independent.
 */

export const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET_MIN = 5 * 60 + 30; // +05:30, fixed year-round
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The five obligatory namaz, with Arabic for display. */
export const PRAYER_META = {
  fajr:    { label: 'Fajr',    arabic: 'الفجر'  },
  zuhr:    { label: 'Zuhr',    arabic: 'الظهر'  },
  asr:     { label: 'Asr',     arabic: 'العصر'  },
  maghrib: { label: 'Maghrib', arabic: 'المغرب' },
  isha:    { label: 'Isha',    arabic: 'العشاء' },
};

/**
 * Tahajjud is not one of the five, but it owns a window of its own: it is
 * where Isha ends. Kept beside PRAYER_META rather than inside it so
 * "the five obligatory namaz" keeps meaning exactly that.
 */
export const TAHAJJUD_META = { label: 'Tahajjud', arabic: 'تهجد' };

/** Everything that can be the current window, keyed the way push() asks. */
const WINDOW_META = { ...PRAYER_META, tahajjud: TAHAJJUD_META };

/**
 * Full day strip, in time order.
 *
 * `kind` carries meaning the UI acts on:
 *   fard   — one of the five obligatory namaz; can be the "current" one
 *   nafl   — Tahajjud: not obligatory, but it does run as a window
 *   marker — not a namaz at all (Sunrise); a boundary moment that must
 *            never render as the current namaz
 */
export const PRAYER_TIMELINE = [
  { key: 'tahajjud', ...TAHAJJUD_META,                    kind: 'nafl'    },
  { key: 'fajr',     ...PRAYER_META.fajr,                 kind: 'fard'    },
  { key: 'sunrise',  label: 'Sunrise',  arabic: 'الشروق', kind: 'marker', note: 'Fajr ends'  },
  { key: 'zuhr',     ...PRAYER_META.zuhr,                 kind: 'fard'    },
  { key: 'asr',      ...PRAYER_META.asr,                  kind: 'fard'    },
  { key: 'maghrib',  ...PRAYER_META.maghrib,              kind: 'fard'    },
  { key: 'isha',     ...PRAYER_META.isha,                 kind: 'fard'    },
];

/** Parse "HH:MM" into { h, m } with range validation. */
export const parseHM = (t) => {
  if (typeof t !== 'string') return null;
  const [hs, ms] = t.split(':');
  const h = Number.parseInt(hs, 10);
  const m = Number.parseInt(ms, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
};

/** Current IST wall clock as { y, m, d, h, min } — device-tz-safe. */
export const readIST = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return {
    y:   Number.parseInt(map.year, 10),
    m:   Number.parseInt(map.month, 10),
    d:   Number.parseInt(map.day, 10),
    // %24 guards the historical "24 at midnight" quirk.
    h:   Number.parseInt(map.hour, 10) % 24,
    min: Number.parseInt(map.minute, 10),
  };
};

/** IST wall-clock components → real epoch-anchored Date. */
export const istWallClockToDate = (y, m, d, h, min) =>
  new Date(Date.UTC(y, m - 1, d, h, min) - IST_OFFSET_MIN * 60 * 1000);

/** Format an "HH:MM" IST string as "4:30 pm". */
export const format12h = (t) => {
  const hm = parseHM(t);
  if (!hm) return '—';
  const suffix = hm.h >= 12 ? 'pm' : 'am';
  const h12 = ((hm.h + 11) % 12) + 1;
  return `${h12}:${String(hm.m).padStart(2, '0')} ${suffix}`;
};

/** Format a Date as an IST wall clock time ("4:30 pm"). */
export const formatClock = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-IN', {
    timeZone: IST_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).toLowerCase();
};

/** Split a duration into h/m/s, clamped at zero. */
export const splitDuration = (ms) => {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
    totalSeconds: total,
  };
};

/** "2:15:33" / "15:33" — the compact running counter. */
export const formatCountdown = (ms) => {
  const { h, m, s } = splitDuration(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/**
 * Build the ordered day strip for display.
 * Each row: { key, label, arabic, kind, note?, time, at, isPast }.
 */
export const buildTimeline = (data) => {
  if (!data) return [];
  const t = data.timings || {};
  const source = {
    tahajjud: data.tahajjud_time,
    fajr:     t.Fajr,
    sunrise:  t.Sunrise,
    zuhr:     t.Dhuhr,   // AlAdhan wire field is Dhuhr; we display Zuhr
    asr:      t.Asr,
    maghrib:  t.Maghrib,
    isha:     t.Isha,
  };

  const nowIST = readIST();
  const nowMs = istWallClockToDate(nowIST.y, nowIST.m, nowIST.d, nowIST.h, nowIST.min).getTime();

  return PRAYER_TIMELINE
    .map((row) => {
      const time = source[row.key];
      const hm = parseHM(time);
      if (!hm) return null;
      let at = istWallClockToDate(nowIST.y, nowIST.m, nowIST.d, hm.h, hm.m);
      // Tahajjud sits in the last third of the night (~2 AM). Once
      // today's has passed, the next one is tomorrow's — roll forward
      // so the strip stays meaningful.
      if (row.key === 'tahajjud' && at.getTime() < nowMs) {
        at = new Date(at.getTime() + DAY_MS);
      }
      return { ...row, time, at, isPast: at.getTime() < nowMs };
    })
    .filter(Boolean);
};

/**
 * Build the five obligatory namaz WINDOWS covering a continuous 48h span.
 *
 * A namaz is valid for a span, not an instant — its window runs until the
 * next one begins. Three facts a naive version gets wrong:
 *
 *   1. SUNRISE ENDS FAJR. Sunrise is not a namaz; it's when Fajr's window
 *      closes. Treating it as one would tell a user at 7 AM that
 *      "Sunrise" is their current namaz.
 *   2. SUNRISE → ZUHR IS A GAP with no obligatory namaz due. Surfaced
 *      honestly rather than pretending one is running.
 *   3. ISHA CROSSES MIDNIGHT and hands over to TAHAJJUD, not to Fajr. At
 *      1 AM the current namaz is Isha, anchored to yesterday evening; once
 *      Tahajjud comes in during the last third of the night, that runs
 *      until Fajr.
 *
 * Adjacent Fajr times are approximated as today's ±24h. Real Fajr drifts
 * ~1 min/day, so the midnight boundary is accurate to within ~60s — which
 * avoids a second API call for neighbouring dates.
 */
export const buildPrayerWindows = (data) => {
  if (!data) return [];
  const t = data.timings || {};

  const nowIST = readIST();
  const at = (timeStr) => {
    const hm = parseHM(timeStr);
    return hm ? istWallClockToDate(nowIST.y, nowIST.m, nowIST.d, hm.h, hm.m) : null;
  };

  const fajr    = at(t.Fajr);
  const sunrise = at(t.Sunrise);
  const zuhr    = at(t.Dhuhr); // wire field is Dhuhr; we call it Zuhr
  const asr     = at(t.Asr);
  const maghrib = at(t.Maghrib);
  const isha    = at(t.Isha);

  if (!fajr || !zuhr) return [];

  const fajrTomorrow  = new Date(fajr.getTime() + DAY_MS);
  const ishaYesterday = isha ? new Date(isha.getTime() - DAY_MS) : null;

  // Tahajjud is what closes Isha. It falls in the last third of the night,
  // so today's value is a small-hours time landing BEFORE today's Fajr —
  // that instance is the one that ends LAST night's Isha. The ordering is
  // asserted rather than assumed: an unusually short night could put the
  // computed time before midnight, in which case the instance we want is
  // the previous day's.
  let tahajjudPre = at(data.tahajjud_time);
  if (tahajjudPre && tahajjudPre.getTime() >= fajr.getTime()) {
    tahajjudPre = new Date(tahajjudPre.getTime() - DAY_MS);
  }
  // It also has to fall after the Isha it closes, or the chain is nonsense.
  if (tahajjudPre && ishaYesterday && tahajjudPre.getTime() <= ishaYesterday.getTime()) {
    tahajjudPre = null;
  }
  const tahajjudNext = tahajjudPre ? new Date(tahajjudPre.getTime() + DAY_MS) : null;

  const windows = [];
  // `metaKey` is which namaz the window is ABOUT — for the post-sunrise
  // gap that's Zuhr (the one being waited for), even though the window
  // is keyed 'gap' so nothing treats it as a running namaz.
  const push = (key, metaKey, start, end, extra = {}) => {
    if (start && end && end.getTime() > start.getTime()) {
      windows.push({
        key,
        label:  WINDOW_META[metaKey].label,
        arabic: WINDOW_META[metaKey].arabic,
        start, end, ...extra,
      });
    }
  };

  // Each `|| fallback` keeps the chain unbroken when the backend hasn't
  // supplied a Tahajjud time: Isha simply runs through to Fajr as before.
  push('isha',     'isha',     ishaYesterday, tahajjudPre || fajr);
  push('tahajjud', 'tahajjud', tahajjudPre,   fajr);   // last third of the night
  push('fajr',     'fajr',     fajr,          sunrise || zuhr);  // closes at sunrise
  push('gap',      'zuhr',     sunrise,       zuhr, { isGap: true });
  push('zuhr',     'zuhr',     zuhr,          asr || maghrib);
  push('asr',      'asr',      asr,           maghrib || isha);
  push('maghrib',  'maghrib',  maghrib,       isha);
  push('isha',     'isha',     isha,          tahajjudNext || fajrTomorrow);  // crosses midnight
  push('tahajjud', 'tahajjud', tahajjudNext,  fajrTomorrow);

  return windows;
};

/**
 * Which window are we inside right now?
 * Returns { key, label, arabic, start, end, isGap, elapsedMs, totalMs }
 * or null when the data was too incomplete to build a chain.
 */
export const findCurrentWindow = (windows) => {
  if (!windows || windows.length === 0) return null;

  // Window boundaries are already epoch-anchored Dates, so a plain
  // Date.now() comparison is both correct and full-precision.
  const nowMs = Date.now();
  const match = windows.find((w) => nowMs >= w.start.getTime() && nowMs < w.end.getTime());
  if (!match) return null;

  const totalMs = match.end.getTime() - match.start.getTime();
  return { ...match, elapsedMs: nowMs - match.start.getTime(), totalMs };
};
