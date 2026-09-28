'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PHASES,
  getPollPhase,
  overrideForDesiredState,
} = require('../../src/utils/pollPhase');
const { istInstant } = require('../../src/utils/istTime');

// A poll for Sehri date 2027-03-10. Its voting window opens 2027-03-09 22:00 IST.
const DATE = '2027-03-10';
const at = (dateStr, h, m = 0) => istInstant(dateStr, h, m);
const poll = (is_active = null) => ({ date: DATE, is_active });

test('automatic schedule walks through every phase once', () => {
  const p = poll();
  assert.equal(getPollPhase(p, at('2027-03-09', 21, 59)), PHASES.CLOSED, 'not open before 22:00 the evening before');
  assert.equal(getPollPhase(p, at('2027-03-09', 22, 0)), PHASES.VOTING, 'opens at 22:00 the evening before');
  assert.equal(getPollPhase(p, at(DATE, 0, 0)), PHASES.VOTING, 'still voting at midnight');
  assert.equal(getPollPhase(p, at(DATE, 9, 59)), PHASES.VOTING);
  assert.equal(getPollPhase(p, at(DATE, 10, 0)), PHASES.SPECIAL_CASE, 'closes on its own at 10:00');
  assert.equal(getPollPhase(p, at(DATE, 16, 59)), PHASES.SPECIAL_CASE);
  assert.equal(getPollPhase(p, at(DATE, 17, 0)), PHASES.ALLOTMENT);
  assert.equal(getPollPhase(p, at(DATE, 18, 0)), PHASES.STATUS);
});

test('a poll never re-enters voting at 22:00 on its own date (the old clock-only bug)', () => {
  assert.equal(getPollPhase(poll(), at(DATE, 22, 30)), PHASES.STATUS);
  assert.equal(getPollPhase(poll(), at('2027-03-11', 3, 0)), PHASES.STATUS);
});

test('forced open (true) extends voting past 10:00 and holds later phases back', () => {
  assert.equal(getPollPhase(poll(true), at(DATE, 11, 0)), PHASES.VOTING);
  assert.equal(getPollPhase(poll(true), at(DATE, 17, 30)), PHASES.VOTING);
});

test('forced closed (false) closes voting early but the day continues on schedule', () => {
  assert.equal(getPollPhase(poll(false), at(DATE, 2, 0)), PHASES.CLOSED);
  assert.equal(getPollPhase(poll(false), at(DATE, 11, 0)), PHASES.SPECIAL_CASE);
});

test('no poll is CLOSED', () => {
  assert.equal(getPollPhase(null), PHASES.CLOSED);
});

test('toggle writes the smallest override: NULL when the schedule already agrees', () => {
  const inWindow = at(DATE, 2, 0);
  const afterWindow = at(DATE, 12, 0);
  assert.equal(overrideForDesiredState(poll(), false, inWindow), false, 'close early → false');
  assert.equal(overrideForDesiredState(poll(false), true, inWindow), null, 'reopen inside window → back to automatic, not an extension');
  assert.equal(overrideForDesiredState(poll(), true, afterWindow), true, 'open after 10:00 → extension');
  assert.equal(overrideForDesiredState(poll(true), false, afterWindow), null, 'close an extension → back to automatic');
});

test('MySQL tinyint overrides (0/1) are understood', () => {
  assert.equal(getPollPhase({ date: DATE, is_active: 1 }, at(DATE, 11)), PHASES.VOTING);
  assert.equal(getPollPhase({ date: DATE, is_active: 0 }, at(DATE, 1)), PHASES.CLOSED);
});
