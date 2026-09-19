/**
 * islamicTheme.js — Quran/Dua-specific facade over the core design tokens.
 *
 * Colors + spacing come from theme/tokens.js (single source of truth).
 * This module adds the Arabic-typography extensions that only Quran and
 * Dua screens need: the Amiri font-family names, the RTL text style
 * triple, and the digit converter used inside verse markers.
 */

import { colors as coreColors } from '../theme';

// Re-export the palette so existing Quran/Dua imports keep working.
export const colors = coreColors;

// Amiri variants loaded once in _layout.tsx via @expo-google-fonts/amiri.
export const fonts = {
  arabic:     'Amiri_400Regular',
  arabicBold: 'Amiri_700Bold',
};

/**
 * Baseline style for any Arabic text run. Consumers spread it and extend
 * with fontSize + lineHeight (which vary between reader body, bismillah,
 * verse markers, etc.).
 *
 * All three properties MUST travel together — pinning them explicitly
 * means the Arabic script renders correctly regardless of the app's
 * I18nManager state (which stays LTR for the rest of the UI).
 */
export const ARABIC_TEXT_STYLE = {
  fontFamily: fonts.arabic,
  textAlign: 'right',
  writingDirection: 'rtl',
  color: colors.ink,
};

/**
 * Convert Western digits to Arabic-Indic digits (U+0660..U+0669).
 * Used inside verse markers so ﴿١﴾ reads correctly in Arabic context.
 */
export const toArabicDigits = (n) =>
  String(n)
    .split('')
    .map((d) => (/\d/.test(d) ? String.fromCharCode(0x0660 + Number(d)) : d))
    .join('');
