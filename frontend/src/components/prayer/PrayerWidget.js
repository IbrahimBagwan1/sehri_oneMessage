import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  AppState,
} from 'react-native';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, ErrorState, RubStar } from '../ui';
import { colors, radius, space, type } from '../../theme';
import {
  buildTimeline,
  buildPrayerWindows,
  findCurrentWindow,
  formatCountdown,
  formatClock,
  format12h,
  splitDuration,
} from './prayerTimes';

// -----------------------------------------------------------------------------
// PrayerWidget — a compact "which namaz are we in, and how long is left"
// card, with the full day's list behind a bottom sheet.
//
// Replaces a ~300px block (big segmented counter + progress bar + a
// horizontally-scrolling ribbon of all eight entries) with a ~96px card.
// Everything that used to be permanently on screen still exists — it
// just lives one tap away, where it belongs, because the answer people
// open the app for is "how long have I got".
//
// The sheet is a bottom-sheet Modal rather than a route because that's
// this app's established pattern for glanceable detail about something
// on the current screen (voter drill-downs, PG actions, pickers), while
// full screens are reserved for destinations with their own identity.
// -----------------------------------------------------------------------------

/**
 * Live countdown that ticks every second.
 *
 * Suspends while the screen is unfocused or the app is backgrounded —
 * a per-second render is cheap for one card but pointless when nobody
 * is looking. Recomputes immediately on resume so the number is never
 * a second stale when the user comes back.
 */
const useLiveCountdown = (targetMs) => {
  const isFocused = useIsFocused();
  const [remaining, setRemaining] = useState(() =>
    targetMs ? Math.max(0, targetMs - Date.now()) : 0
  );

  useEffect(() => {
    if (!targetMs) return undefined;

    const compute = () => setRemaining(Math.max(0, targetMs - Date.now()));
    compute();

    if (!isFocused) return undefined;

    let interval = setInterval(compute, 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        compute();
        if (!interval) interval = setInterval(compute, 1000);
      } else if (interval) {
        clearInterval(interval);
        interval = null;
      }
    });

    return () => {
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, [targetMs, isFocused]);

  return remaining;
};

export default function PrayerWidget({ data, loading, error, onRetry }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const timeline = useMemo(() => buildTimeline(data), [data]);
  const windows  = useMemo(() => buildPrayerWindows(data), [data]);

  // Deliberately NOT memoised: findCurrentWindow reads Date.now(), and
  // the countdown below re-renders this component once a second, so
  // recomputing here means the card rolls over to the next namaz the
  // instant a window ends — with no extra state and no effect.
  //
  // (An earlier version kept a `tick` counter and bumped it from an
  // effect when the countdown hit zero. That worked but caused a
  // cascading render on every boundary; this is both simpler and
  // cheaper — it's a scan of at most seven windows.)
  //
  // `windows` is memoised, so `current.end` stays a stable Date
  // reference and the countdown effect below doesn't thrash.
  const current = findCurrentWindow(windows);
  const remainingMs = useLiveCountdown(current?.end?.getTime());

  // ---- Loading ---------------------------------------------------------
  // A skeleton rather than a spinner: the card keeps its final height so
  // the rest of the screen doesn't jump when data lands.
  if (loading) {
    return (
      <Card padding={false}>
        <View style={styles.body}>
          <View style={{ flex: 1 }}>
            <View style={[styles.skel, { width: 92, height: 10 }]} />
            <View style={[styles.skel, { width: 130, height: 24, marginTop: 10 }]} />
            <View style={[styles.skel, { width: 100, height: 10, marginTop: 8 }]} />
          </View>
          <View style={[styles.skel, { width: 86, height: 30 }]} />
        </View>
        <View style={styles.progressTrack} />
      </Card>
    );
  }

  if (error) {
    return <Card><ErrorState message={error} onRetry={onRetry} /></Card>;
  }

  if (!current) {
    return (
      <Card>
        <ErrorState
          message="Namaz times aren't available right now."
          onRetry={onRetry}
        />
      </Card>
    );
  }

  const { h, m, s } = splitDuration(remainingMs);
  const progress = current.totalMs
    ? Math.min(1, Math.max(0, current.elapsedMs / current.totalMs))
    : 0;

  // Under five minutes of the window left. Amber, not red — a window
  // closing is a nudge, not an error.
  const isUrgent = !current.isGap && remainingMs > 0 && remainingMs < 5 * 60_000;

  return (
    <>
      <Card padding={false} style={isUrgent ? styles.cardUrgent : undefined}>
        <Pressable
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => pressed && styles.pressed}
          accessibilityRole="button"
          accessibilityLabel={
            `${current.label}${current.isGap ? ' begins' : ' namaz ends'} in ` +
            `${h} hours ${m} minutes ${s} seconds. Tap to see all namaz times.`
          }
        >
          <View style={styles.body}>
            {/* Left — which namaz, and when it ends */}
            <View style={styles.left}>
              <View style={styles.eyebrowRow}>
                <RubStar size={9} />
                <Text style={[styles.eyebrow, isUrgent && styles.eyebrowUrgent]}>
                  {current.isGap ? 'UP NEXT' : 'CURRENT NAMAZ'}
                </Text>
              </View>

              <View style={styles.nameRow}>
                <Text style={styles.name}>{current.label}</Text>
                <Text style={styles.arabic} allowFontScaling={false}>
                  {current.arabic}
                </Text>
              </View>

              <Text style={styles.sub}>
                {current.isGap
                  ? `begins ${formatClock(current.end)}`
                  : `until ${formatClock(current.end)}`}
              </Text>
            </View>

            {/* Right — the live counter */}
            <View style={styles.right}>
              <Text
                style={[styles.countdown, isUrgent && styles.countdownUrgent]}
                accessibilityRole="timer"
                allowFontScaling={false}
              >
                {formatCountdown(remainingMs)}
              </Text>
              <Text style={[styles.countdownLabel, isUrgent && styles.eyebrowUrgent]}>
                {current.isGap ? 'until start' : 'time left'}
              </Text>
            </View>
          </View>

          {/* Hairline progress along the card's bottom edge — shows how
              far through the window we are without spending a whole row
              on a chunky bar. */}
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                isUrgent && styles.progressFillUrgent,
                { width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>

          {/* Explicit affordance — the whole card is tappable, but the
              link makes that discoverable. */}
          <View style={styles.footer}>
            <Text style={styles.footerLink}>View all prayers</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.tealDark} />
          </View>
        </Pressable>
      </Card>

      <AllPrayersSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        timeline={timeline}
        current={current}
        data={data}
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// AllPrayersSheet — the full day, one tap away.
// -----------------------------------------------------------------------------
function AllPrayersSheet({ visible, onClose, timeline, current, data }) {
  const gregorian = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long',
  });

  // The strip's "current" marker follows the same rule as the widget:
  // during the post-sunrise gap nothing is running, so Zuhr is ringed
  // as up-next instead.
  const currentKey = current?.isGap ? null : current?.key;
  const upNextKey  = current?.isGap ? 'zuhr' : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => { /* absorb */ }}>
          <View style={styles.handle} />

          {/* Header — ornamented, matching the app's section treatment */}
          <View style={styles.sheetHead}>
            <View style={styles.ornamentRow}>
              <View style={styles.ornamentRule} />
              <RubStar size={12} />
              <View style={styles.ornamentRule} />
            </View>
            <Text style={styles.sheetTitle}>Namaz times</Text>
            <Text style={styles.sheetDate}>
              {data?.date_hijri ? `${data.date_hijri} · ${gregorian}` : gregorian}
            </Text>
            {data?.city ? (
              <Text style={styles.sheetCity}>
                {data.city}{data.country ? `, ${data.country}` : ''}
              </Text>
            ) : null}
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollBody}
            showsVerticalScrollIndicator={false}
          >
            {timeline.map((row) => {
              const isCurrent = row.key === currentKey;
              const isUpNext  = row.key === upNextKey;
              // Only Sunrise is a boundary marker now. Tahajjud runs as a
              // real window (it is where Isha ends), so it gets namaz
              // weight rather than the softened marker treatment.
              const isMarker  = row.kind === 'marker';
              const dim = row.isPast && !isCurrent && !isUpNext;

              return (
                <View
                  key={row.key}
                  style={[
                    styles.row,
                    isCurrent && styles.rowCurrent,
                    isUpNext && styles.rowUpNext,
                  ]}
                  accessibilityLabel={
                    `${row.label} ${format12h(row.time)}` +
                    (isCurrent ? ', current namaz' : isUpNext ? ', up next' : '')
                  }
                >
                  {/* Status rail — a filled bar marks the running namaz */}
                  <View style={[
                    styles.rail,
                    isCurrent && styles.railCurrent,
                    isUpNext && styles.railUpNext,
                  ]} />

                  <View style={{ flex: 1 }}>
                    <View style={styles.rowNameLine}>
                      <Text style={[
                        styles.rowName,
                        isMarker && styles.rowNameMarker,
                        dim && styles.dim,
                        (isCurrent || isUpNext) && styles.rowNameActive,
                      ]}>
                        {row.label}
                      </Text>
                      {/* Caption sits inline rather than on its own line —
                          keeps every row one line tall so the whole day
                          fits without scrolling, and reads better too. */}
                      {row.note ? (
                        <Text style={[styles.rowNote, dim && styles.dim]} numberOfLines={1}>
                          {row.note}
                        </Text>
                      ) : null}
                      {isCurrent && (
                        <View style={styles.nowPill}>
                          <View style={styles.nowDot} />
                          <Text style={styles.nowPillText}>now</Text>
                        </View>
                      )}
                      {isUpNext && (
                        <View style={styles.nextPill}>
                          <Text style={styles.nextPillText}>next</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Arabic — gold, Amiri, the typographic anchor of each row */}
                  <Text
                    style={[styles.rowArabic, dim && styles.rowArabicDim]}
                    allowFontScaling={false}
                  >
                    {row.arabic}
                  </Text>

                  <Text style={[
                    styles.rowTime,
                    dim && styles.dim,
                    (isCurrent || isUpNext) && styles.rowTimeActive,
                  ]}>
                    {format12h(row.time)}
                  </Text>
                </View>
              );
            })}

            {/* Provenance. Only shown when we genuinely fell back — and
                worded calmly, because the local calculation is verified
                accurate to within a minute of the almanac. */}
            {data?.is_from_api === false && (
              <View style={styles.sourceNote}>
                <Ionicons name="shield-checkmark-outline" size={13} color={colors.inkFaint} />
                <Text style={styles.sourceText}>
                  Calculated on our server using the Karachi method — the same
                  method the almanac uses. Accurate to within a minute.
                </Text>
              </View>
            )}
          </ScrollView>

          <Button label="Close" variant="secondary" onPress={onClose} fullWidth />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ---- Compact card ----------------------------------------------------
  cardUrgent: { borderColor: colors.warn },
  pressed:    { opacity: 0.85 },

  body: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[3],
    gap: space[3],
  },
  left:  { flex: 1 },
  right: { alignItems: 'flex-end' },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  eyebrow: {
    ...type.micro,
    color: colors.tealDark,
    fontWeight: '800',
    letterSpacing: 0.6,
    fontSize: 9,
  },
  eyebrowUrgent: { color: colors.warn },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: 5 },
  name: { fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  arabic: {
    fontFamily: 'Amiri_700Bold',
    fontSize: 19,
    color: colors.gold,
    lineHeight: 28,
    includeFontPadding: false,
  },
  sub: { ...type.micro, color: colors.inkFaint, marginTop: 3, fontVariant: ['tabular-nums'] },

  countdown: {
    fontSize: 27,
    fontWeight: '800',
    color: colors.tealDark,
    letterSpacing: -0.6,
    // Tabular numerals stop digits shifting sideways each tick.
    fontVariant: ['tabular-nums'],
    lineHeight: 31,
  },
  countdownUrgent: { color: colors.warn },
  countdownLabel: {
    ...type.micro,
    color: colors.inkFaint,
    fontWeight: '700',
    fontSize: 9,
    letterSpacing: 0.4,
    marginTop: 1,
  },

  progressTrack: { height: 3, backgroundColor: colors.ruleFaint, width: '100%' },
  progressFill:  { height: '100%', backgroundColor: colors.teal },
  progressFillUrgent: { backgroundColor: colors.warn },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: space[2],
    backgroundColor: colors.tealSoft,
  },
  footerLink: { ...type.micro, color: colors.tealDark, fontWeight: '700' },

  skel: { backgroundColor: colors.ruleFaint, borderRadius: radius.sm },

  // ---- Sheet -----------------------------------------------------------
  overlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[5],
    paddingTop: space[3],
    paddingBottom: space[3],
    maxHeight: '92%',
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[3],
  },

  sheetHead: { alignItems: 'center', marginBottom: space[2] },
  ornamentRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    width: 150, marginBottom: space[1],
  },
  ornamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },
  sheetTitle: { ...type.h2, color: colors.ink },
  sheetDate:  { ...type.meta, color: colors.inkMuted, marginTop: 3, textAlign: 'center' },
  sheetCity:  { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  // flexShrink is load-bearing: the sheet is height-capped, and without
  // it this ScrollView sizes to its content and simply gets clipped by
  // the parent — the last row (Isha) disappeared off the bottom and the
  // list wouldn't scroll to reveal it, because as far as the ScrollView
  // knew it already had all the room it needed.
  sheetScroll:     { flexShrink: 1, marginBottom: space[3] },
  sheetScrollBody: { paddingBottom: space[1] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    // Tightened so the whole day (8 entries) fits without scrolling on a
    // typical phone — a prayer list you have to scroll defeats the point
    // of opening it for a glance.
    paddingVertical: space[2],
    paddingRight: space[3],
    borderRadius: radius.md,
    marginBottom: 1,
  },
  rowCurrent: { backgroundColor: colors.tealSoft },
  rowUpNext:  { backgroundColor: colors.goldSoft },

  // Left rail: the vertical status bar for each row.
  rail: {
    width: 3, alignSelf: 'stretch', minHeight: 30,
    borderRadius: 2,
    backgroundColor: colors.ruleFaint,
    marginLeft: space[2],
  },
  railCurrent: { backgroundColor: colors.teal },
  railUpNext:  { backgroundColor: colors.gold },

  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  rowName:       { ...type.bodyStrong, color: colors.ink },
  rowNameMarker: { fontWeight: '600', color: colors.inkMuted },
  rowNameActive: { color: colors.tealDark },
  rowNote:       { ...type.micro, color: colors.inkGhost, fontStyle: 'italic', flexShrink: 1 },
  dim:           { color: colors.inkGhost },

  rowArabic: {
    fontFamily: 'Amiri_400Regular',
    fontSize: 18,
    lineHeight: 26,
    color: colors.gold,
    includeFontPadding: false,
  },
  rowArabicDim: { color: colors.inkGhost },

  rowTime: {
    ...type.body,
    color: colors.inkMuted,
    fontVariant: ['tabular-nums'],
    minWidth: 74,
    textAlign: 'right',
  },
  rowTimeActive: { color: colors.tealDark, fontWeight: '800' },

  nowPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.teal,
    borderRadius: radius.pill,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  nowDot:      { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.paper },
  nowPillText: { ...type.micro, color: colors.paper, fontWeight: '800', fontSize: 9 },

  nextPill: {
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.gold,
    borderRadius: radius.pill,
    paddingHorizontal: 7, paddingVertical: 1,
  },
  nextPillText: { ...type.micro, color: colors.gold, fontWeight: '800', fontSize: 9 },

  sourceNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  sourceText: { ...type.micro, color: colors.inkFaint, flex: 1, lineHeight: 15 },
});
