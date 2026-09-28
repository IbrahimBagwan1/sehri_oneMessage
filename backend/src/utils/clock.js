'use strict';

/**
 * clock.js — the single source of "now" for everything that depends on the
 * IST calendar: poll phases, which poll is current, which poll a delivery
 * run belongs to, poll creation dates, and account deletion's "today".
 *
 * It exists so the test suite can walk a whole Sehri day — 22:00, midnight,
 * 10:00, a run crossing midnight — on a controllable clock, against the
 * real endpoints. Setting the clock is refused outside NODE_ENV=test, so
 * nothing in production can move it.
 */

let fixedMs = null;

const now = () => (fixedMs == null ? new Date() : new Date(fixedMs));

const assertTest = () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('clock can only be set in tests');
};

/** Freeze "now" at `date` (tests only). */
const set = (date) => {
  assertTest();
  fixedMs = new Date(date).getTime();
};

/** Move the frozen clock forward (tests only). */
const advance = (ms) => {
  assertTest();
  fixedMs = (fixedMs == null ? Date.now() : fixedMs) + ms;
};

/** Back to real time. */
const reset = () => { fixedMs = null; };

module.exports = { now, set, advance, reset };
