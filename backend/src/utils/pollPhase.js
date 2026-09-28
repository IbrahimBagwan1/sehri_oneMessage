'use strict';

/**
 * pollPhase.js — Single source of truth for poll timing logic.
 *
 * Every controller that needs to know "what phase is this poll in right
 * now?" must use getPollPhase() from this file. No controller should
 * re-implement time comparisons independently.
 *
 * A poll row is keyed by the SEHRI DATE it collects votes for (`polls.date`,
 * "YYYY-MM-DD" in IST). Its day runs like this, all times IST:
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  date−1 22:00 → date 10:00   VOTING        members vote yes / no │
 * │  date   10:00 → 17:00        SPECIAL_CASE  opt in / opt out      │
 * │  date   17:00 → 18:00        ALLOTMENT     super admin decides   │
 * │  date   18:00 onwards        STATUS        final list, read only │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * WHY THE PHASE IS A FUNCTION OF THE POLL'S DATE, NOT JUST THE CLOCK
 * The previous version looked only at the current IST hour. At 22:00 that
 * put TODAY's poll — whose kitchen run was already cooked and delivered —
 * straight back into VOTING, because "22:00–09:59 is the voting window" is
 * true of every day. Anchoring each window to the poll's own date makes
 * a poll's life one-way: it opens once, closes once, and ends in STATUS.
 *
 * THE MANUAL OVERRIDE (`is_active`) IS THREE-STATE
 *   null  → automatic: the table above, nothing else.
 *   true  → forced OPEN: voting stays open past 10:00 (an extension).
 *   false → forced CLOSED: voting shut early, before 10:00.
 *
 * It used to be two-state, and poll creation set `true` whenever it ran in
 * the voting window. Since `true` outside the window means "extended", every
 * poll created at night stayed open all the next day: special cases and
 * allotment never started unless a super admin remembered to close voting
 * by hand, and the dashboard reported a manual extension nobody had made.
 * Creation now writes null. See setVotingOpen() for how the toggle keeps the
 * override from outliving the decision that set it.
 *
 * `deadline_time` records when the override was last changed. It is audit
 * data only and is never read back here.
 */

const { istInstant, addDays } = require('./istTime');

// ---------------------------------------------------------------------------
// Phase constants — import these in controllers, never use raw strings.
// ---------------------------------------------------------------------------
const PHASES = Object.freeze({
  VOTING: 'voting',             // date−1 22:00 – date 10:00
  SPECIAL_CASE: 'special_case', // 10:00 – 17:00
  ALLOTMENT: 'allotment',       // 17:00 – 18:00
  STATUS: 'status',             // 18:00 onwards
  CLOSED: 'closed',             // no poll, not open yet, or voting force-closed
});

// ---------------------------------------------------------------------------
// Window boundaries — IST hours in 24h format.
// Change here only; never put these numbers directly in controllers.
// ---------------------------------------------------------------------------
const WINDOWS = Object.freeze({
  VOTING_OPEN_HOUR: 22,        // 10:00 PM the evening BEFORE the poll's date
  VOTING_CLOSE_HOUR: 10,       // 10:00 AM on the poll's date
  SPECIAL_CASE_CLOSE_HOUR: 17, //  5:00 PM
  ALLOTMENT_CLOSE_HOUR: 18,    //  6:00 PM
});

/** Returns the current UTC Date — one "now" for controllers to share. */
const getNow = () => new Date();

/** Normalise the stored override into true | false | null. */
const overrideOf = (poll) => {
  const v = poll?.is_active;
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  return null;
};

/** The instants that bound a poll's phases. */
const windowsFor = (dateStr) => ({
  opensAt:        istInstant(addDays(dateStr, -1), WINDOWS.VOTING_OPEN_HOUR),
  closesAt:       istInstant(dateStr, WINDOWS.VOTING_CLOSE_HOUR),
  specialEndsAt:  istInstant(dateStr, WINDOWS.SPECIAL_CASE_CLOSE_HOUR),
  allotmentEndsAt: istInstant(dateStr, WINDOWS.ALLOTMENT_CLOSE_HOUR),
});

/**
 * Determines the current phase of a poll.
 *
 * @param {object|null} poll — Poll instance or plain { date, is_active }.
 * @param {Date} [now]       — injectable for tests.
 * @returns {string}         — One of the PHASES constants.
 */
const getPollPhase = (poll, now = getNow()) => {
  if (!poll || !poll.date) return PHASES.CLOSED;

  const override = overrideOf(poll);
  const w = windowsFor(String(poll.date).slice(0, 10));
  const t = now.getTime();

  if (t < w.opensAt.getTime()) {
    // Not open yet. A super admin may still open it early on purpose.
    return override === true ? PHASES.VOTING : PHASES.CLOSED;
  }
  if (t < w.closesAt.getTime()) {
    return override === false ? PHASES.CLOSED : PHASES.VOTING;
  }

  // Past the scheduled close. An explicit extension keeps voting going and
  // holds the later phases back until it is lifted.
  if (override === true) return PHASES.VOTING;
  if (t < w.specialEndsAt.getTime()) return PHASES.SPECIAL_CASE;
  if (t < w.allotmentEndsAt.getTime()) return PHASES.ALLOTMENT;
  return PHASES.STATUS;
};

/** Would voting be open right now on the automatic schedule alone? */
const isScheduledVoting = (poll, now = getNow()) =>
  getPollPhase(poll ? { ...(poll.get ? poll.get({ plain: true }) : poll), is_active: null } : null, now)
    === PHASES.VOTING;

/**
 * The override value that makes voting open (or closed) right now, without
 * leaving a standing override behind when the schedule already agrees.
 *
 * "Close" inside the window writes false — an early close. "Open" inside
 * the window writes null, because the schedule already has it open; writing
 * true there would silently turn into an extension at 10:00, which is the
 * exact bug the three-state model exists to prevent. Symmetrically, "open"
 * after the window writes true (an extension) and "close" writes null.
 *
 * @returns {true|false|null}
 */
const overrideForDesiredState = (poll, wantOpen, now = getNow()) => {
  const scheduledOpen = isScheduledVoting(poll, now);
  return wantOpen === scheduledOpen ? null : Boolean(wantOpen);
};

// ---------------------------------------------------------------------------
// Convenience wrappers — use these in controllers, not raw PHASES comparisons.
// ---------------------------------------------------------------------------

/** True when users may submit yes/no votes. */
const isVotingOpen = (poll, now) => getPollPhase(poll, now) === PHASES.VOTING;

/** True when users may raise or undo special cases. */
const isSpecialCaseWindowOpen = (poll, now) => getPollPhase(poll, now) === PHASES.SPECIAL_CASE;

/** True when the super admin may approve/reject special cases. */
const isAllotmentWindowOpen = (poll, now) => getPollPhase(poll, now) === PHASES.ALLOTMENT;

module.exports = {
  PHASES,
  WINDOWS,
  getPollPhase,
  isVotingOpen,
  isSpecialCaseWindowOpen,
  isAllotmentWindowOpen,
  isScheduledVoting,
  overrideForDesiredState,
  overrideOf,
  windowsFor,
  getNow,
};
