/**
 * theme/tokens.js — the single source of truth for the OneMessage design system.
 *
 * Everything visual across the app pulls from here: colors, type scale,
 * spacing, radii, elevation. Screens should not hard-code hex values or
 * one-off spacings; if you need a value that isn't here, add it here first.
 *
 * Palette rationale (see design plan):
 *   • ink family for text, on a paper background — never pure white
 *   • teal (#0D9488) is action / brand / live / links
 *   • gold (#B8860B) is reverent — bismillah, verse markers, "today's dua"
 *   • semantic colors used only for state (success / warn / danger)
 */

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
export const colors = {
  // Ink (text) — always on paper backgrounds, never on colored fills.
  ink:       '#0F172A',
  inkMuted:  '#334155',
  inkFaint:  '#64748B',
  inkGhost:  '#94A3B8',

  // Paper (surfaces) — a warm-cool neutral background, never pure white body.
  paper:     '#FFFFFF',
  paperSoft: '#F8FAFC',
  paperWarm: '#FDFCF9',   // used for hero sections + Quran/Dua surfaces
  ruleFaint: '#F1F5F9',   // hairline dividers
  ruleSoft:  '#E2E8F0',   // 1px borders on cards + inputs

  // Teal — brand / action / live / links.
  teal:       '#0D9488',
  tealDark:   '#0F766E',   // pressed / hover
  tealSoft:   '#F0FDF9',   // fills
  tealBorder: '#CCFBF1',

  // Gold — reserved. Only for reverent elements (bismillah, verse markers,
  // "today's dua" eyebrow) or subtle structural ornament.
  gold:       '#B8860B',
  goldSoft:   '#FAF4E6',
  goldBorder: '#E8D8A8',

  // Semantic — status only, never brand.
  success:      '#16A34A',
  successSoft:  '#DCFCE7',
  warn:         '#D97706',
  warnSoft:     '#FEF3C7',
  danger:       '#DC2626',
  dangerSoft:   '#FEE2E2',

  // Overlay
  scrim: 'rgba(15, 23, 42, 0.55)',
};

// ---------------------------------------------------------------------------
// Typography scale
// ---------------------------------------------------------------------------
// System fonts render the app UI. Amiri (loaded in _layout.tsx) is applied
// only to Arabic script in Quran/Dua screens via ARABIC_TEXT_STYLE.
export const type = {
  // Display (hero surah name, screen title on landing pages)
  displayLg: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: colors.ink },
  display:   { fontSize: 24, lineHeight: 30, fontWeight: '800', color: colors.ink },

  // Screen title (in-page hero, section landing)
  h1: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: colors.ink },
  // Section header
  h2: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: colors.ink },
  // Card title
  h3: { fontSize: 15, lineHeight: 20, fontWeight: '700', color: colors.ink },

  // Body copy
  body:       { fontSize: 15, lineHeight: 22, fontWeight: '400', color: colors.inkMuted },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.ink },

  // Meta / secondary
  meta:       { fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.inkFaint },
  metaStrong: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.ink },

  // Micro — badges, eyebrows, timestamps. **No letter-spacing, no uppercase.**
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '700', color: colors.inkFaint },
};

// ---------------------------------------------------------------------------
// Spacing — 4-based scale
// ---------------------------------------------------------------------------
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
};

// ---------------------------------------------------------------------------
// Radii
// ---------------------------------------------------------------------------
export const radius = {
  sm:   6,
  md:   8,
  lg:   12,
  xl:   16,
  pill: 999,
};

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------
// Kept deliberately sparse — flat 1px borders are the default (see Card).
// Elevation is reserved for floating action buttons, modal sheets, and
// the featured-today card.
export const elevation = {
  none: {
    elevation: 0,
    shadowColor: 'transparent',
  },
  low: {
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },
  medium: {
    elevation: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
  },
};

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
export const layout = {
  screenPadding:  space[4],   // 16 — every screen's horizontal padding
  cardPadding:    space[4],   // 16 — inside a card
  sectionGap:     space[6],   // 24 — between distinct sections on a screen
  minTouchTarget: 44,          // iOS HIG / Material — everything tappable ≥ 44px
};
