'use strict';

/**
 * contentFilter.js — the "filter" in Apple guideline 1.2's
 * filter / report / block / contact.
 *
 * Reporting and blocking react to abuse after someone has seen it. Apple
 * also asks for "a method for filtering objectionable material from being
 * posted", so the worst of it never reaches the room at all. This is that
 * method: a server-side check on every chat message, before it is stored or
 * broadcast.
 *
 * WHAT IT IS, AND IS NOT
 * A conservative blocklist of unambiguous profanity and slurs — in English,
 * in romanised Hindi/Urdu/Kannada, and in the native scripts this community
 * writes in (Devanagari, Urdu/Arabic, Kannada). It is deliberately NOT a
 * clever classifier: every false positive is a member whose ordinary
 * message was refused, in a religious community app where trust matters
 * more than coverage. Words that are also ordinary words ("cock", "kutta",
 * "saala", Hindi "chod" = "leave", Arabic curses that also appear in
 * scripture) are left out on purpose; reports handle the rest. The test
 * suite (tests/unit/contentFilter.test.js) holds a list of legitimate
 * Islamic and everyday phrases in five languages that must always pass.
 *
 * Operators can extend the list without a code change:
 *   CHAT_BLOCKED_TERMS=word1,word2,…   (whole words, Latin or any script)
 *
 * Normalisation defeats the cheap evasions: case, accents (fùck), full-width
 * letters, Cyrillic look-alikes (fuсk with a Cyrillic с), zero-width
 * characters, digit/symbol swaps (sh1t, $hit, b!tch), letters stretched for
 * emphasis (fuuuuck), and separators between letters (f.u.c.k).
 */

// ---------------------------------------------------------------------------
// Latin-script terms, matched as whole words against normalised text.
// `\w*` suffixes catch inflections for stems that are never innocent.
// ---------------------------------------------------------------------------
const LATIN_PATTERNS = [
  // English
  'fu+c+k\\w*', 'fu+k\\w*', 'fu+q\\w*', 'fck\\w*', 'fvck\\w*', 'phuck\\w*', 'f\\*+ck\\w*', 'f\\*+k',
  'motherfuck\\w*', 'shi+t(?!ake)\\w*', 'sh\\*+t\\w*', 'bullshit\\w*', 'bi+tch\\w*', 'b\\*+tch\\w*',
  'bastard\\w*', 'asshole\\w*', 'arsehole\\w*', 'cunt\\w*', 'pussy', 'whore\\w*', 'slut\\w*',
  'nigger\\w*', 'nigga\\w*', 'faggot\\w*', 'retard\\w*', 'wanker\\w*', 'twat\\w*',
  'dickhead\\w*', 'porn\\w*',
  // Romanised Hindi / Urdu
  'madarchod\\w*', 'maderchod\\w*', 'madarchood\\w*', 'behenchod\\w*', 'bhenchod\\w*',
  'benchod\\w*', 'bhosdi\\w*', 'bhosadi\\w*', 'bhosda\\w*', 'bsdk', 'chutiya\\w*',
  'chutiye', 'chutia\\w*', 'gandu\\w*', 'gaandu\\w*', 'gaand', 'lund', 'lauda', 'lavda',
  'lawda', 'randi\\w*', 'bhadwa\\w*', 'bhadwe', 'kanjar\\w*', 'haramzad\\w*', 'harami?zada\\w*',
  // Romanised Kannada
  'bolimag\\w*', 'bolimaga\\w*', 'soolemag\\w*', 'sulemag\\w*', 'bosudik\\w*',
];
// Deliberately absent: bare "chod" and "fag" ("chod do" is everyday Hindi
// for "leave it"; "fag" is British slang for a cigarette), and two-word
// spellings like "behen chod" — "meri behen chodkar gayi" ("my sister
// left") is an ordinary sentence.

// ---------------------------------------------------------------------------
// Native-script terms, matched as substrings (scripts without the Latin
// notion of word boundaries, and inflected forms attach suffixes).
// ---------------------------------------------------------------------------
const SCRIPT_TERMS = [
  // Devanagari (Hindi)
  'मादरचोद', 'बहनचोद', 'भेनचोद', 'बेहनचोद', 'भोसड़ी', 'भोसडी', 'चूतिया', 'चुतिया', 'रंडी',
  'हरामजादा', 'हरामज़ादा', 'हरामजादी', 'गांडू', 'लौड़ा',
  // Urdu (Arabic script)
  'مادرچود', 'بہنچود', 'بہن چود', 'بھوسڑی', 'چوتیا', 'رنڈی', 'حرامزادہ', 'حرامزادی',
  // Arabic
  'كسمك', 'كس امك', 'كس أمك', 'شرموط', 'منيوك', 'قحبة',
  // Kannada
  'ಸೂಳೆ', 'ಬೋಳಿಮಗ', 'ಬೋಸುಡಿ',
];
// Deliberately absent: يلعن / لعنة ("curse") — they appear in the Qur'an
// and in ordinary religious speech.

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

// Cyrillic and Greek letters that render identically to Latin ones.
const HOMOGLYPHS = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', і: 'i', ј: 'j', ѕ: 's',
  ο: 'o', α: 'a', ε: 'e', κ: 'k', τ: 't', υ: 'u', ν: 'v',
};

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
const ARABIC_DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g; // tashkeel + tatweel

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extraTerms = () =>
  (process.env.CHAT_BLOCKED_TERMS || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);

let compiled = null;
let compiledFrom = null;

const matchers = () => {
  const source = process.env.CHAT_BLOCKED_TERMS || '';
  if (!compiled || compiledFrom !== source) {
    const extras = extraTerms();
    const latinExtras = extras.filter((t) => /^[\x20-\x7e]+$/.test(t)).map(escapeRegex);
    const scriptExtras = extras.filter((t) => !/^[\x20-\x7e]+$/.test(t));
    compiled = {
      latin: new RegExp(`(?:^|[^a-z])(?:${[...LATIN_PATTERNS, ...latinExtras].join('|')})(?=$|[^a-z])`, 'i'),
      script: [...SCRIPT_TERMS, ...scriptExtras].map((t) => t.normalize('NFC').replace(ARABIC_DIACRITICS, '')),
    };
    compiledFrom = source;
  }
  return compiled;
};

/**
 * Latin normalisation: compatibility-fold (full-width → ASCII), strip
 * Latin accents only (U+0300–036F — Devanagari and Kannada vowel signs live
 * in other blocks and are untouched), map look-alike letters, undo
 * digit/symbol swaps, join single letters separated by punctuation, and
 * collapse runs of three or more identical letters.
 */
const normalise = (text) => {
  let t = String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(ZERO_WIDTH, '');
  t = t.toLowerCase();
  t = t.replace(/[Ѐ-ӿͰ-Ͽ]/g, (c) => HOMOGLYPHS[c] || c);
  t = t.replace(/[0134570@$!]/g, (c) => LEET[c] || c);
  // "f.u.c.k" / "f u c k" / "f-u-c-k" → "fuck" (only runs of single letters)
  t = t.replace(/\b(?:[a-z][\s.\-_]){2,}[a-z]\b/g, (m) => m.replace(/[\s.\-_]/g, ''));
  t = t.replace(/([a-z])\1{2,}/g, '$1');
  return t;
};

/** Native-script normalisation: canonical form, no zero-width or tashkeel. */
const normaliseScript = (text) =>
  String(text || '').normalize('NFC').replace(ZERO_WIDTH, '').replace(ARABIC_DIACRITICS, '');

/** True when the message contains a blocked term. */
const isObjectionable = (text) => {
  const { latin, script } = matchers();
  if (latin.test(normalise(text))) return true;
  const native = normaliseScript(text);
  return script.some((term) => native.includes(term));
};

module.exports = { isObjectionable, normalise };
