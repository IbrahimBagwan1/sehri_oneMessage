import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type } from '../../theme';
import RubStar from './RubStar';

/**
 * Calendar — month-grid date picker shared by the user's vote history and
 * the super admin's poll lookup.
 *
 * Deliberately dependency-free: adding a calendar library for one grid
 * would pull a theming surface we'd have to fight to match the app's
 * teal/gold system. This is ~1 screen of date math and renders natively.
 *
 * Props
 *   selected      'YYYY-MM-DD' | null   currently selected day
 *   onSelect      (iso) => void         fired when a day is tapped
 *   markers       { [iso]: 'yes'|'no'|'special'|'neutral' }
 *                                        coloured dot under a day
 *   minDate       'YYYY-MM-DD' | null   days before this are disabled
 *   maxDate       'YYYY-MM-DD' | null   days after this are disabled
 *                                        (defaults to today — no future polls)
 *   initialMonth  'YYYY-MM-DD' | null   which month to open on
 *   footerHint    string                 small caption under the grid
 *
 * All dates are handled as plain 'YYYY-MM-DD' strings in IST. We never
 * construct a Date from a bare 'YYYY-MM-DD' for comparison (that parses
 * as UTC midnight and can shift a day in +05:30); string compare is
 * both correct and cheaper for ISO dates.
 */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Today's date in IST as 'YYYY-MM-DD'. en-CA gives ISO ordering natively. */
export const todayISO = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Build 'YYYY-MM-DD' from numeric parts without touching Date/UTC. */
const iso = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Parse 'YYYY-MM-DD' into { y, m (0-indexed), d }. Null-safe. */
const parseISO = (s) => {
  if (typeof s !== 'string') return null;
  const parts = s.split('-');
  if (parts.length !== 3) return null;
  const y = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10) - 1;
  const d = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return { y, m, d };
};

const MARKER_COLORS = {
  yes:     colors.success,
  no:      colors.danger,
  special: colors.gold,
  neutral: colors.teal,
};

export default function Calendar({
  selected = null,
  onSelect,
  markers = {},
  minDate = null,
  maxDate = todayISO(),
  initialMonth = null,
  footerHint = null,
}) {
  const anchor = parseISO(initialMonth) || parseISO(selected) || parseISO(todayISO());
  const [view, setView] = useState({ y: anchor.y, m: anchor.m });

  const goPrev = useCallback(() => {
    setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  }, []);
  const goNext = useCallback(() => {
    setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));
  }, []);

  // Grid cells: leading blanks to line the 1st up under its weekday,
  // then one cell per day. Date(y, m+1, 0).getDate() = days in month,
  // and Date(y, m, 1).getDay() = weekday index of the 1st. Both are
  // local-calendar arithmetic on numeric parts, not timezone parsing.
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const count = new Date(view.y, view.m + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < first; i += 1) out.push(null);
    for (let d = 1; d <= count; d += 1) out.push(d);
    return out;
  }, [view.y, view.m]);

  // Disable the next-month arrow once we're at the month containing
  // maxDate — there's nothing meaningful to page forward into.
  const maxParsed = parseISO(maxDate);
  const atMaxMonth =
    maxParsed && view.y === maxParsed.y && view.m === maxParsed.m;
  const minParsed = parseISO(minDate);
  const atMinMonth =
    minParsed && view.y === minParsed.y && view.m === minParsed.m;

  const today = todayISO();

  return (
    <View style={styles.wrap}>
      {/* Month header with ornament rules, matching the app's section style */}
      <View style={styles.header}>
        <Pressable
          onPress={goPrev}
          disabled={!!atMinMonth}
          hitSlop={10}
          style={({ pressed }) => [
            styles.navBtn,
            pressed && styles.navBtnPressed,
            atMinMonth && styles.navBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={atMinMonth ? colors.inkGhost : colors.tealDark}
          />
        </Pressable>

        <View style={styles.headerCenter}>
          <View style={styles.ornamentRow}>
            <View style={styles.ornamentRule} />
            <RubStar size={10} />
            <View style={styles.ornamentRule} />
          </View>
          <Text style={styles.monthLabel}>
            {MONTHS[view.m]} {view.y}
          </Text>
        </View>

        <Pressable
          onPress={goNext}
          disabled={!!atMaxMonth}
          hitSlop={10}
          style={({ pressed }) => [
            styles.navBtn,
            pressed && styles.navBtnPressed,
            atMaxMonth && styles.navBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={atMaxMonth ? colors.inkGhost : colors.tealDark}
          />
        </Pressable>
      </View>

      {/* Weekday strip */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <View key={`${w}-${i}`} style={styles.weekCell}>
            <Text style={styles.weekText}>{w}</Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      <View style={styles.grid}>
        {cells.map((d, i) => {
          if (d === null) {
            return <View key={`blank-${i}`} style={styles.dayCell} />;
          }
          const dayISO   = iso(view.y, view.m, d);
          const isSel    = selected === dayISO;
          const isToday  = today === dayISO;
          const marker   = markers[dayISO];
          const tooEarly = minDate && dayISO < minDate;
          const tooLate  = maxDate && dayISO > maxDate;
          const disabled = tooEarly || tooLate;

          return (
            <Pressable
              key={dayISO}
              onPress={() => { if (!disabled) onSelect?.(dayISO); }}
              disabled={disabled}
              style={({ pressed }) => [
                styles.dayCell,
                pressed && !disabled && !isSel && styles.dayCellPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel, disabled: !!disabled }}
              accessibilityLabel={`${d} ${MONTHS[view.m]} ${view.y}${marker ? `, ${marker}` : ''}`}
            >
              <View
                style={[
                  styles.dayInner,
                  isToday && !isSel && styles.dayToday,
                  isSel && styles.daySelected,
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    disabled && styles.dayTextDisabled,
                    isToday && !isSel && styles.dayTextToday,
                    isSel && styles.dayTextSelected,
                  ]}
                >
                  {d}
                </Text>
              </View>
              {/* Marker dot sits below the disc so it never overlaps the
                  numeral, and flips to paper-white inside a selected disc
                  so it stays visible against the teal fill. */}
              <View style={styles.dotSlot}>
                {marker ? (
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: isSel ? colors.paper : (MARKER_COLORS[marker] || colors.teal) },
                    ]}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {footerHint ? <Text style={styles.footerHint}>{footerHint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space[2] },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[2],
    marginBottom: space[3],
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  ornamentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    width: 120,
    marginBottom: 4,
  },
  ornamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },
  monthLabel: { ...type.h3, color: colors.ink },

  // 44x44 hit target — meets the platform minimum for tappable controls.
  navBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.ruleSoft,
    backgroundColor: colors.paper,
  },
  navBtnPressed:  { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  navBtnDisabled: { opacity: 0.4 },

  weekRow: { flexDirection: 'row', marginBottom: space[1] },
  weekCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  weekText: { ...type.micro, color: colors.inkFaint, fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // 100/7 keeps 7 columns exact without sub-pixel drift from fixed widths.
  dayCell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 3,
  },
  dayCellPressed: { opacity: 0.6 },

  dayInner: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: colors.gold,
  },
  daySelected: {
    backgroundColor: colors.teal,
  },
  dayText:          { ...type.body, color: colors.ink, fontVariant: ['tabular-nums'] },
  dayTextDisabled:  { color: colors.inkGhost },
  dayTextToday:     { color: colors.tealDark, fontWeight: '800' },
  dayTextSelected:  { color: colors.paper, fontWeight: '800' },

  dotSlot: { height: 8, justifyContent: 'center' },
  dot:     { width: 5, height: 5, borderRadius: 2.5 },

  footerHint: {
    ...type.micro,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: space[3],
  },
});
