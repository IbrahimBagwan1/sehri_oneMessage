'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  istParts,
  istDateString,
  istHour,
  addDays,
  istInstant,
  istDayOfYear,
} = require('../../src/utils/istTime');

test('IST midnight is hour 0, never 24', () => {
  // 18:30 UTC is 00:00 IST the next day.
  const midnight = new Date('2027-03-09T18:30:00Z');
  assert.equal(istHour(midnight), 0);
  assert.equal(istDateString(midnight), '2027-03-10');
});

test('every hour of an IST day maps to 0–23', () => {
  const start = istInstant('2027-03-10', 0, 0).getTime();
  for (let h = 0; h < 24; h += 1) {
    const d = new Date(start + h * 3600 * 1000);
    assert.equal(istHour(d), h);
  }
});

test('the IST date differs from the UTC date between 00:00 and 05:30 IST', () => {
  const d = new Date('2027-03-09T20:00:00Z'); // 01:30 IST on the 10th
  assert.equal(d.toISOString().slice(0, 10), '2027-03-09');
  assert.equal(istDateString(d), '2027-03-10');
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
});

test('istInstant round-trips through istParts', () => {
  const p = istParts(istInstant('2027-03-10', 22, 15));
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2027, 3, 10, 22, 15]);
});

test('day of year is 0-based and IST-anchored', () => {
  assert.equal(istDayOfYear(istInstant('2027-01-01', 0, 5)), 0);
  assert.equal(istDayOfYear(new Date('2026-12-31T19:00:00Z')), 0, '00:30 IST on 1 Jan');
});
