'use strict';

/**
 * istTime.js — the one place that turns an instant into an IST wall clock.
 *
 * The community runs on Asia/Kolkata time and the server usually does not
 * (almost every host is UTC). Before this file existed the conversion was
 * copied into eight places, in three different styles, and two of them had
 * already produced midnight bugs.
 *
 * THE MIDNIGHT TRAP
 * `hour12: false` asks for a 24-hour clock but does not say WHICH one. Some
 * ICU builds pick the h24 cycle and format midnight as "24", which silently
 * fails every `hour < 10` comparison for an hour. `hourCycle: 'h23'` pins the
 * 0–23 cycle, and the `% 24` is kept as a second guard for engines that
 * ignore the option. Never derive an IST hour any other way.
 *
 * IST has no daylight saving, so a fixed +05:30 offset is exact in both
 * directions; that is what istInstant relies on.
 */

const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** { year, month, day, hour, minute } of `date` on the IST wall clock. */
const istParts = (date = new Date()) => {
  const out = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  out.hour %= 24;
  if ([out.year, out.month, out.day, out.hour, out.minute].some((n) => !Number.isFinite(n))) {
    throw new Error(`istTime: could not read IST parts for ${date.toISOString()}`);
  }
  return out;
};

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of `date` in IST. */
const istDateString = (date = new Date()) => {
  const { year, month, day } = istParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
};

/** Current IST hour, 0–23. */
const istHour = (date = new Date()) => istParts(date).hour;

/** Shift a "YYYY-MM-DD" by whole days. Pure calendar arithmetic, no time zone. */
const addDays = (dateStr, days) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** The absolute instant at which the IST wall clock reads `dateStr hour:minute`. */
const istInstant = (dateStr, hour = 0, minute = 0) => {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - IST_OFFSET_MS);
};

/** Day of the year (0-based) of `date` in IST. */
const istDayOfYear = (date = new Date()) => {
  const { year, month, day } = istParts(date);
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000);
};

module.exports = {
  IST_TZ,
  istParts,
  istDateString,
  istHour,
  addDays,
  istInstant,
  istDayOfYear,
};
