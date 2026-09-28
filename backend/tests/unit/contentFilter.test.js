'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isObjectionable } = require('../../src/services/contentFilter');

// Every one of these must pass. A false positive here is a member whose
// ordinary message was refused — treat a failure as a filter bug.
const LEGITIMATE = {
  english: [
    'Assalamu alaikum, has the food reached?',
    'Walaikum assalam brother',
    'Alhamdulillah, Jazakallah khair for the Sehri',
    "Insha'Allah see you at Fajr",
    'Mashallah, Subhanallah, Allahu Akbar',
    'Astaghfirullah, I forgot to vote',
    'Please pass the dates',
    'Masjid gate 3, near the shop',
    'Sehri at 4:30, 5 packets please',
    'Call me on 9876543210',
    'Gandhi Nagar PG, second floor',
    'class assessment tomorrow',
    'Scunthorpe', 'Essex', 'Middlesex', 'cocktail', 'Dickson Road', 'therapist',
    'shiitake mushrooms', 'grass', 'passport', 'Hancock',
    'going for a fag break',
    'Grand Masjid', 'Sussex', 'analytics', 'Ramadan Kareem', 'Eid Mubarak',
  ],
  hindi_urdu_romanised: [
    'chod do yaar, kal dekhenge',
    'meri behen chodkar gayi',
    'bhai khana kab aayega',
    'theek hai, abhi aata hoon',
    'gandagi mat karo',
    'Allah hafiz',
    'Khuda hafiz bhai',
    'shukriya',
  ],
  kannada_romanised: [
    'namaskara, oota yavaga barutte',
    'dhanyavadagalu',
    'sari, naale sigona',
  ],
  arabic: [
    'السلام عليكم ورحمة الله وبركاته',
    'إن شاء الله',
    'ما شاء الله',
    'الحمد لله رب العالمين',
    'سبحان الله',
    'جزاك الله خيرا',
    'رمضان كريم',
    'لعنة الله على الظالمين', // Qur'anic phrasing — must not be blocked
  ],
  urdu: [
    'آپ کیسے ہیں',
    'شکریہ',
    'اللہ حافظ',
    'کھانا کب آئے گا',
  ],
  hindi: [
    'भाई खाना कब आएगा',
    'धन्यवाद',
    'इंशाअल्लाह',
    'सेहरी का समय क्या है',
    'वह बहुत घमंडी है',
  ],
  kannada: [
    'ನಮಸ್ಕಾರ',
    'ಊಟ ಯಾವಾಗ ಬರುತ್ತೆ',
    'ಧನ್ಯವಾದಗಳು',
  ],
};

const ABUSIVE = [
  // plain
  'fuck this', 'what the shit', 'madarchod', 'bhenchod!', 'chutiya hai', 'you bitch',
  // obfuscated
  'fuuuuuck', 'fuuck', 'sh1t', '$h!t', 'b!tch', 'f.u.c.k', 'F U C K', 'f*ck', 'sh*t', 'fvck', 'phuck',
  'fùck', 'ｆｕｃｋ', 'f​uck', 'fuсk' /* Cyrillic с */,
  // native scripts
  'तू चूतिया है', 'मादरचोद', 'رنڈی', 'كس امك', 'شرموطة', 'ಸೂಳೆ ಮಗ',
  // romanised Kannada
  'bolimaga', 'soolemagane',
];

for (const [language, phrases] of Object.entries(LEGITIMATE)) {
  test(`no false positives: ${language}`, () => {
    for (const text of phrases) {
      assert.equal(isObjectionable(text), false, `wrongly blocked: ${text}`);
    }
  });
}

test('blocks abuse, including cheap obfuscation and native scripts', () => {
  for (const text of ABUSIVE) {
    assert.equal(isObjectionable(text), true, `not blocked: ${text}`);
  }
});

test('operators can extend the list without code changes, in any script', () => {
  const prev = process.env.CHAT_BLOCKED_TERMS;
  process.env.CHAT_BLOCKED_TERMS = 'spamword, another, ಕೆಟ್ಟಪದ';
  try {
    assert.equal(isObjectionable('buy spamword now'), true);
    assert.equal(isObjectionable('ಇದು ಕೆಟ್ಟಪದ'), true);
    assert.equal(isObjectionable('nothing here'), false);
  } finally {
    if (prev === undefined) delete process.env.CHAT_BLOCKED_TERMS;
    else process.env.CHAT_BLOCKED_TERMS = prev;
  }
});
