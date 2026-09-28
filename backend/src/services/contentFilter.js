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
 * A conservative blocklist of unambiguous profanity and slurs, in English
 * and in the romanised Hindi/Urdu this community actually types. It is
 * deliberately NOT a clever classifier: every false positive is a member
 * whose ordinary message was refused, in a religious community app where
 * trust matters more than coverage. Terms that are also ordinary words
 * ("cock", "kutta", "saala") are left out on purpose; moderation handles the
 * rest through reports.
 *
 * Operators can extend the list without a deploy of new code:
 *   CHAT_BLOCKED_TERMS=word1,word2,…   (matched as whole words)
 *
 * Normalisation defeats the obvious evasions — case, repeated letters used
 * for emphasis ("fuuuuck"), common digit/symbol swaps ("sh1t", "@ss"),
 * and separators between letters ("f.u.c.k").
 */

// Whole-word patterns, applied to normalised text. `\\w*` suffixes catch
// inflections (fucking, fucker) for stems that are never innocent.
const BASE_PATTERNS = [
  // English
  'fuck\\w*', 'motherfuck\\w*', 'shit\\w*', 'bullshit', 'bitch\\w*', 'bastard\\w*',
  'asshole\\w*', 'arsehole\\w*', 'cunt\\w*', 'pussy', 'whore\\w*', 'slut\\w*',
  'nigger\\w*', 'nigga\\w*', 'faggot\\w*', 'retard\\w*', 'wanker\\w*', 'twat\\w*',
  'dickhead\\w*', 'porn\\w*',
  // Romanised Hindi / Urdu
  'madarchod\\w*', 'maderchod\\w*', 'madarchood\\w*', 'behenchod\\w*', 'bhenchod\\w*',
  'benchod\\w*', 'bhosdi\\w*', 'bhosadi\\w*', 'bhosda\\w*', 'bsdk', 'chutiya\\w*',
  'chutiye', 'chutia\\w*', 'gandu\\w*', 'gaandu\\w*', 'gaand', 'lund', 'lauda', 'lavda',
  'lawda', 'randi\\w*', 'bhadwa\\w*', 'bhadwe', 'kanjar\\w*',
];
// Bare "chod" and "fag" are deliberately absent: "chod do" is everyday
// Hindi for "leave it", and "fag" is ordinary British slang for a cigarette.
// So are two-word spellings like "behen chod": "meri behen chodkar gayi"
// ("my sister left") is an ordinary sentence.

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extraPatterns = () =>
  (process.env.CHAT_BLOCKED_TERMS || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2)
    .map(escapeRegex);

let compiled = null;
let compiledFrom = null;

const matcher = () => {
  const source = process.env.CHAT_BLOCKED_TERMS || '';
  if (!compiled || compiledFrom !== source) {
    const all = [...BASE_PATTERNS, ...extraPatterns()];
    compiled = new RegExp(`(?:^|[^a-z])(?:${all.join('|')})(?=$|[^a-z])`, 'i');
    compiledFrom = source;
  }
  return compiled;
};

/**
 * Lowercase, undo digit/symbol swaps, strip separators placed between
 * single letters, and collapse runs of 3+ identical letters to one.
 */
const normalise = (text) => {
  let t = String(text || '').toLowerCase();
  t = t.replace(/[0134570@$!]/g, (c) => LEET[c] || c);
  // "f.u.c.k" / "f u c k" / "f-u-c-k" → "fuck" (only runs of single letters)
  t = t.replace(/\b(?:[a-z][\s.\-_*]){2,}[a-z]\b/g, (m) => m.replace(/[\s.\-_*]/g, ''));
  t = t.replace(/([a-z])\1{2,}/g, '$1');
  return t;
};

/** True when the message contains a blocked term. */
const isObjectionable = (text) => {
  const t = normalise(text);
  return matcher().test(t) || matcher().test(t.replace(/([a-z])\1+/g, '$1'));
};

module.exports = { isObjectionable, normalise };
