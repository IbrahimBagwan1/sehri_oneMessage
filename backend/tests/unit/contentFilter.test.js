'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isObjectionable } = require('../../src/services/contentFilter');

test('blocks unambiguous profanity in English and romanised Hindi/Urdu', () => {
  for (const text of ['fuck this', 'what the shit', 'madarchod', 'bhenchod!', 'chutiya hai']) {
    assert.equal(isObjectionable(text), true, text);
  }
});

test('sees through the usual evasions', () => {
  for (const text of ['fuuuuuck', 'sh1t', 'f.u.c.k', 'F U C K', '$h!t']) {
    assert.equal(isObjectionable(text), true, text);
  }
});

test('does not block ordinary community messages (false positives are the real risk)', () => {
  for (const text of [
    'Assalamu alaikum, has the food reached?',
    'chod do yaar, kal dekhenge',
    'meri behen chodkar gayi',
    'class assessment tomorrow',
    'Grand Masjid gate 2',
    'Sehri at 4:30, 5 packets please',
    'Call me on 9876543210',
    'Scunthorpe',
    'going for a fag break',
  ]) {
    assert.equal(isObjectionable(text), false, text);
  }
});

test('operators can extend the list without code changes', () => {
  const prev = process.env.CHAT_BLOCKED_TERMS;
  process.env.CHAT_BLOCKED_TERMS = 'spamword, another';
  try {
    assert.equal(isObjectionable('buy spamword now'), true);
    assert.equal(isObjectionable('nothing here'), false);
  } finally {
    if (prev === undefined) delete process.env.CHAT_BLOCKED_TERMS;
    else process.env.CHAT_BLOCKED_TERMS = prev;
  }
});
