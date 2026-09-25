// @ts-nocheck
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Dimensions,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/useAuthStore';
import { prayersApi } from '../../api/prayers';
import { pollsApi } from '../../api/polls';
import {
  Avatar,
  Button,
  Card,
  Chip,
  ErrorState,
  Header,
  Hero,
  LoadingState,
  RubStar,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// ==========================================
// Constants
// ==========================================
const PHASE = {
  VOTING:       'voting',
  SPECIAL_CASE: 'special_case',
  ALLOTMENT:    'allotment',
  STATUS:       'status',
  CLOSED:       'closed',
};

/**
 * Canonical order of the ribbon. Tahajjud + Imsak sit at the start
 * during Ramadan because they matter for the community's rhythm; the
 * six daily prayers follow in their natural time order.
 */
const PRAYER_TIMELINE = [
  { key: 'tahajjud', label: 'Tahajjud', extended: true  },
  { key: 'imsak',    label: 'Imsak',    extended: true  },
  { key: 'fajr',     label: 'Fajr',     extended: false },
  { key: 'sunrise',  label: 'Sunrise',  extended: false },
  { key: 'dhuhr',    label: 'Dhuhr',    extended: false },
  { key: 'asr',      label: 'Asr',      extended: false },
  { key: 'maghrib',  label: 'Maghrib',  extended: false },
  { key: 'isha',     label: 'Isha',     extended: false },
];

/**
 * Ribbon nodes that are NOT obligatory prayers. They stay on the
 * timeline because the community needs them, but they can never be the
 * "current prayer" and the caption stops them being read as one:
 *   • Sunrise — the moment Fajr's window closes
 *   • Imsak   — when the fast begins in Ramadan
 *   • Tahajjud — voluntary night prayer
 */
const NON_PRAYER_NOTE = {
  sunrise:  'Fajr ends',
  imsak:    'fast begins',
  tahajjud: 'voluntary',
};

// -------------------------------------------------------------------------
// Pure helpers — deterministic, testable
//
// IMPORTANT — timezone strategy:
// Prayer times are IST wall-clock strings ("05:30") produced by the
// backend prayerService. The countdown, next-prayer picker, and
// isPast checks must all reason in IST regardless of the device's
// local timezone (a traveler in Dubai on an IST community app is a
// real user segment). We therefore:
//   1. read "now" as IST wall-clock components via Intl.DateTimeFormat
//      (matches the safe pattern in backend/utils/pollPhase.js — plain
//      `toLocaleString(..., { hour12: false })` returns "24" at
//      midnight on some Node/V8 versions),
//   2. anchor every prayer's clock time to TODAY's IST calendar date,
//   3. convert that IST wall-clock instant into a real epoch-based Date
//      by subtracting the fixed +05:30 IST offset (IST has no DST, so
//      this is exact),
//   4. compare using .getTime(), which is UTC-epoch and therefore
//      device-timezone-independent.
// -------------------------------------------------------------------------

const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET_MIN = 5 * 60 + 30;   // +05:30, fixed year-round
const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse "HH:MM" into { h, m } with range validation. */
const parseHM = (t) => {
  if (typeof t !== 'string') return null;
  const [hs, ms] = t.split(':');
  const h = Number.parseInt(hs, 10);
  const m = Number.parseInt(ms, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
};

/**
 * Read the current IST wall clock as { y, m, d, h, min } — device-tz-safe.
 * `Intl.DateTimeFormat({ hour12: false }).formatToParts()` reliably returns
 * 0–23 across supported Node/RN versions; we still `% 24` the hour as a
 * defense against the historical "24 at midnight" quirk.
 */
const readIST = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TZ,
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  return {
    y:   Number.parseInt(map.year, 10),
    m:   Number.parseInt(map.month, 10),
    d:   Number.parseInt(map.day, 10),
    h:   Number.parseInt(map.hour, 10) % 24,
    min: Number.parseInt(map.minute, 10),
  };
};

/**
 * Convert IST wall-clock components to an epoch-anchored Date instant.
 * IST is fixed +05:30 (no DST), so `Date.UTC(y, m-1, d, h-5, min-30)`
 * yields the exact UTC instant matching that IST moment.
 */
const istWallClockToDate = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(Date.UTC(y, m - 1, d, h, min) - IST_OFFSET_MIN * 60 * 1000);

/** Format an "HH:MM" IST clock string as "h:mm am/pm". */
const format12h = (t) => {
  const hm = parseHM(t);
  if (!hm) return '—';
  const suffix = hm.h >= 12 ? 'pm' : 'am';
  const h12 = ((hm.h + 11) % 12) + 1;
  return `${h12}:${String(hm.m).padStart(2, '0')} ${suffix}`;
};

/**
 * Format a Date as an IST wall clock time ("4:30 pm"). Used for the
 * window start/end labels, which are real Date instants rather than the
 * raw "HH:MM" strings format12h takes.
 */
const formatClock = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return date
    .toLocaleTimeString('en-IN', {
      timeZone: IST_TZ,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase();
};

const gregorianLine = () =>
  new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' });

/**
 * Turn the AlAdhan-shaped response into the ordered ribbon rows.
 * Each row: { key, label, time (raw IST string), at (Date), isPast, extended }.
 */
const buildTimeline = (data) => {
  if (!data) return [];
  const t = data.timings || {};
  const source = {
    tahajjud: data.tahajjud_time,
    imsak:    data.imsak_time || t.Imsak,
    fajr:     t.Fajr,
    sunrise:  t.Sunrise,
    dhuhr:    t.Dhuhr,
    asr:      t.Asr,
    maghrib:  t.Maghrib,
    isha:     t.Isha,
  };

  const nowIST = readIST();
  const nowMs  = istWallClockToDate(nowIST.y, nowIST.m, nowIST.d, nowIST.h, nowIST.min).getTime();

  return PRAYER_TIMELINE
    .map((row) => {
      const time = source[row.key];
      const hm = parseHM(time);
      if (!hm) return null;
      let at = istWallClockToDate(nowIST.y, nowIST.m, nowIST.d, hm.h, hm.m);
      // Tahajjud sits in the last third of the night (~2 AM IST). Once
      // today's IST clock time for it has passed, the *next* Tahajjud is
      // tomorrow's — roll the anchor forward one full day so the
      // countdown and ribbon stay meaningful.
      if (row.key === 'tahajjud' && at.getTime() < nowMs) {
        at = new Date(at.getTime() + DAY_MS);
      }
      return { ...row, time, at, isPast: at.getTime() < nowMs };
    })
    .filter(Boolean);
};

/**
 * Build the five obligatory prayer WINDOWS for the current moment.
 *
 * A namaz is valid for a span of time, not an instant — the window for
 * each prayer runs until the next one begins. Getting this right means
 * modelling three things the naive "list of times" view gets wrong:
 *
 *   1. SUNRISE ENDS FAJR. Sunrise is not a prayer; it is the moment
 *      Fajr's window closes. Treating it as a prayer would tell a user
 *      at 7 AM that "Sunrise" is their current namaz, which is wrong.
 *
 *   2. SUNRISE → DHUHR IS A GAP. There is no obligatory prayer in that
 *      stretch. We surface it honestly as "no prayer right now, Dhuhr
 *      is next" rather than pretending one is active.
 *
 *   3. ISHA CROSSES MIDNIGHT. Its window ends at the NEXT day's Fajr,
 *      so at 1 AM the current prayer is Isha — anchored to yesterday.
 *
 * To cover all 24 hours without gaps we build a chain spanning
 * yesterday's Isha through tomorrow's Fajr, then pick whichever window
 * brackets "now".
 *
 * Tomorrow's / yesterday's Fajr are approximated as today's Fajr ±24h.
 * Real Fajr drifts about a minute a day, so the boundary is accurate to
 * within ~60 s — immaterial for a countdown, and it avoids a second API
 * call for adjacent dates.
 */
const buildPrayerWindows = (data) => {
  if (!data) return [];
  const t = data.timings || {};

  const nowIST = readIST();
  const at = (timeStr, dayOffset = 0) => {
    const hm = parseHM(timeStr);
    if (!hm) return null;
    const d = istWallClockToDate(nowIST.y, nowIST.m, nowIST.d, hm.h, hm.m);
    return dayOffset ? new Date(d.getTime() + dayOffset * DAY_MS) : d;
  };

  const fajr    = at(t.Fajr);
  const sunrise = at(t.Sunrise);
  const dhuhr   = at(t.Dhuhr);
  const asr     = at(t.Asr);
  const maghrib = at(t.Maghrib);
  const isha    = at(t.Isha);

  // Without Fajr and Dhuhr we can't anchor anything meaningful.
  if (!fajr || !dhuhr) return [];

  const fajrTomorrow  = new Date(fajr.getTime() + DAY_MS);
  const ishaYesterday = isha ? new Date(isha.getTime() - DAY_MS) : null;

  const windows = [];
  const push = (key, label, start, end, extra = {}) => {
    if (start && end && end.getTime() > start.getTime()) {
      windows.push({ key, label, start, end, ...extra });
    }
  };

  // Yesterday's Isha still running into this morning's Fajr.
  push('isha', 'Isha', ishaYesterday, fajr);
  // Fajr closes at sunrise, not at Dhuhr.
  push('fajr', 'Fajr', fajr, sunrise || dhuhr);
  // The no-obligatory-prayer stretch after sunrise.
  push('gap', 'Dhuhr', sunrise, dhuhr, { isGap: true });
  push('dhuhr',   'Dhuhr',   dhuhr,   asr || maghrib);
  push('asr',     'Asr',     asr,     maghrib || isha);
  push('maghrib', 'Maghrib', maghrib, isha);
  // Tonight's Isha runs to tomorrow's Fajr.
  push('isha', 'Isha', isha, fajrTomorrow);

  return windows;
};

/**
 * Which window are we inside right now?
 *
 * Returns { key, label, start, end, isGap, elapsedMs, totalMs } or null
 * if the data was too incomplete to build a chain. The chain covers a
 * continuous 48-hour span, so under normal data a match always exists.
 */
const findCurrentWindow = (windows) => {
  if (!windows || windows.length === 0) return null;

  // Window boundaries are already epoch-anchored Dates (istWallClockToDate
  // converts IST wall clock to a real UTC instant), so a plain Date.now()
  // comparison is both correct and full-precision — no timezone maths
  // needed at this layer.
  const nowMs = Date.now();

  const match = windows.find((w) => nowMs >= w.start.getTime() && nowMs < w.end.getTime());
  if (!match) return null;

  const totalMs   = match.end.getTime() - match.start.getTime();
  const elapsedMs = nowMs - match.start.getTime();
  return { ...match, elapsedMs, totalMs };
};

/**
 * Split a duration into h/m/s parts for the segmented countdown display.
 * Clamped at zero so a boundary crossing never renders negative numbers
 * in the moment before the window recomputes.
 */
const splitDuration = (ms) => {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
    totalSeconds: total,
  };
};

// -------------------------------------------------------------------------
// Live countdown hook — ticks every second so the counter visibly runs.
//
// A once-a-minute tick (what this used to do) makes a "time left" readout
// look frozen, which is the whole thing the user watches. One render per
// second is cheap for a single card, and we keep it honest by suspending
// the interval whenever the screen isn't actually being looked at:
//   • screen not focused (user on another tab) — useIsFocused
//   • app backgrounded — AppState
// On resume we recompute immediately rather than waiting a tick, so the
// number is never stale for a second after the user returns.
// -------------------------------------------------------------------------
const useLiveCountdown = (targetMs, enabled = true) => {
  const isFocused = useIsFocused();
  const [remaining, setRemaining] = useState(() =>
    targetMs ? Math.max(0, targetMs - Date.now()) : 0
  );

  useEffect(() => {
    if (!targetMs || !enabled) return undefined;

    const compute = () => setRemaining(Math.max(0, targetMs - Date.now()));
    compute(); // immediate, so resuming never shows a stale value

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
  }, [targetMs, enabled, isFocused]);

  return remaining;
};

// =========================================================================
// Screen
// =========================================================================
export default function HomeScreen() {
  const router          = useRouter();
  const user            = useAuthStore((s) => s.user);
  const isGuest         = useAuthStore((s) => s.isGuest);
  const available_roles = useAuthStore((s) => s.available_roles);
  const switchRole      = useAuthStore((s) => s.switchRole);

  const [prayerData,    setPrayerData]  = useState<any>(null);
  const [pollData,      setPollData]    = useState<any>(null);
  const [loadingPrayer, setLoadingP]    = useState(true);
  const [loadingPoll,   setLoadingV]    = useState(true);
  const [prayerError,   setPrayerErr]   = useState<string | null>(null);
  const [pollError,     setPollErr]     = useState<string | null>(null);
  const [submittingVote,    setSubmitting]        = useState(false);
  const [submittingSpecial, setSubmittingSpecial] = useState(false);
  const [refreshing,    setRefreshing]  = useState(false);

  // Full name, not just the first word — the greeting reads as a proper
  // salaam to the person. Internal whitespace is collapsed so a stray
  // double-space in the stored name doesn't render as a gap.
  const displayName = useMemo(() => {
    if (isGuest) return 'friend';
    return (user?.name || 'Friend').trim().replace(/\s+/g, ' ');
  }, [user?.name, isGuest]);

  // ---- Data loaders ----------------------------------------------------
  const loadPrayer = useCallback(async () => {
    setPrayerErr(null);
    try {
      const res = await prayersApi.getToday();
      if (res.success) setPrayerData(res.data);
    } catch {
      setPrayerErr("Couldn't load today's prayer times.");
    } finally {
      setLoadingP(false);
    }
  }, []);

  const loadPoll = useCallback(async () => {
    // Guests don't call the poll endpoint — it requires an authenticated
    // user id to attach voter identity. We render a sign-in invite in
    // place of the poll card instead.
    if (isGuest) { setLoadingV(false); return; }
    setPollErr(null);
    try {
      const res = await pollsApi.getActive();
      if (res.success) setPollData(res.data);
    } catch {
      setPollErr("Couldn't load today's Sehri poll.");
    } finally {
      setLoadingV(false);
    }
  }, [isGuest]);

  useFocusEffect(useCallback(() => {
    loadPrayer();
    loadPoll();
    if (isGuest) return undefined;   // no polling for guests
    const t = setInterval(loadPoll, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [loadPrayer, loadPoll, isGuest]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadPrayer(), isGuest ? Promise.resolve() : loadPoll()]);
    setRefreshing(false);
  }, [loadPrayer, loadPoll, isGuest]);

  // ---- Actions ---------------------------------------------------------
  const handleVote = async (vote) => {
    if (!pollData?.poll) return;
    setSubmitting(true);
    try {
      await pollsApi.submitVote(pollData.poll.id, vote);
      await loadPoll();
    } catch (err) {
      Alert.alert('Vote not recorded', err?.response?.data?.message || "Couldn't submit your vote. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Raise a special case (opt-in "want" if user voted 'no', or
  // opt-out "dont_want" if user voted 'yes'). Backend enforces window
  // (10 AM–5 PM IST) and that the user has already voted — we only
  // render this action when both are true, but the try/catch surfaces
  // any 4xx cleanly anyway.
  const handleSpecialCase = async (type) => {
    if (!pollData?.poll) return;
    setSubmittingSpecial(true);
    try {
      await pollsApi.submitSpecialCase(pollData.poll.id, type);
      await loadPoll();
    } catch (err) {
      Alert.alert(
        "Couldn't submit special case",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setSubmittingSpecial(false);
    }
  };

  // Retract a pending special case. Backend rejects if a super admin
  // has already reviewed it (sehri_allowed !== null) — friendly alert
  // on that path.
  const handleUndoSpecial = async () => {
    if (!pollData?.poll) return;
    setSubmittingSpecial(true);
    try {
      await pollsApi.undoSpecialCase(pollData.poll.id);
      await loadPoll();
    } catch (err) {
      Alert.alert(
        "Couldn't undo",
        err?.response?.data?.message || 'Try again in a moment.'
      );
    } finally {
      setSubmittingSpecial(false);
    }
  };

  const handleSwitch = async (role) => {
    try {
      const result = await switchRole(role);
      if (result.isRider) return router.push('/(rider)/map');
      if (role === 'super_admin') return router.replace('/super-admin/superadmin-dashboard');
      if (role === 'admin') return router.replace('/(admin)');
    } catch (err) {
      Alert.alert("Couldn't switch role", err?.response?.data?.message || 'Try again in a moment.');
    }
  };

  // ---- Derived ---------------------------------------------------------
  const timeline = useMemo(() => buildTimeline(prayerData), [prayerData]);
  const windows  = useMemo(() => buildPrayerWindows(prayerData), [prayerData]);

  // `windowTick` forces the current-window lookup to re-run when a
  // boundary is crossed. Without it the card would keep counting down
  // past zero into a window that already ended, because findCurrentWindow
  // is a useMemo and nothing else would invalidate it.
  const [windowTick, setWindowTick] = useState(0);
  const current = useMemo(
    () => findCurrentWindow(windows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [windows, windowTick]
  );

  const remainingMs = useLiveCountdown(current?.end?.getTime());

  // Roll over to the next window the moment this one expires.
  useEffect(() => {
    if (!current?.end) return;
    if (remainingMs > 0) return;
    setWindowTick((n) => n + 1);
  }, [remainingMs, current?.end]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        leading={<Wordmark />}
        trailing={
          isGuest ? (
            <Button
              label="Sign in"
              variant="ghost"
              size="sm"
              icon="log-in-outline"
              onPress={() => router.push('/(auth)/login')}
            />
          ) : (
            <Avatar
              name={user?.name}
              size={38}
              onPress={() => router.push('/profile')}
              accessibilityLabel="Open profile"
            />
          )
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.teal]}
            tintColor={colors.teal}
          />
        }
      >
        <Hero
          greeting={isGuest ? 'Assalamu alaikum — welcome' : 'Assalamu alaikum'}
          name={isGuest ? 'to OneMessage' : displayName}
          dateLine={
            prayerData?.date_hijri
              ? `${prayerData.date_hijri} · ${gregorianLine()}`
              : gregorianLine()
          }
        />

        {available_roles.length > 1 && (
          <View style={styles.roleRow}>
            <Text style={styles.roleLabel}>Switch to</Text>
            <View style={styles.roleChips}>
              {available_roles.includes('rider') && (
                <Chip label="Rider" tone="teal" icon="bicycle-outline" onPress={() => handleSwitch('rider')} />
              )}
              {available_roles.includes('admin') && (
                <Chip label="Zone admin" tone="teal" icon="shield-outline" onPress={() => handleSwitch('admin')} />
              )}
              {available_roles.includes('super_admin') && (
                <Chip label="Super admin" tone="teal" icon="key-outline" onPress={() => handleSwitch('super_admin')} />
              )}
            </View>
          </View>
        )}

        {/* -------------------- Prayer timeline card -------------------- */}
        <View style={styles.section}>
          <SectionHeader
            title="Prayer times"
            subtitle={prayerData?.city ? `${prayerData.city}, ${prayerData.country || 'India'}` : undefined}
            ornament="star"
          />

          {loadingPrayer ? (
            <Card><LoadingState message="Loading today's prayer times…" compact /></Card>
          ) : prayerError ? (
            <Card><ErrorState message={prayerError} onRetry={loadPrayer} /></Card>
          ) : timeline.length === 0 ? (
            <Card><ErrorState message="No prayer times available right now." onRetry={loadPrayer} /></Card>
          ) : (
            <PrayerCard
              timeline={timeline}
              current={current}
              remainingMs={remainingMs}
              isFallback={prayerData?.is_from_api === false}
            />
          )}
        </View>

        {/* -------------------- Sehri poll card -------------------- */}
        <View style={styles.section}>
          <SectionHeader
            title="Today's Sehri poll"
            trailing={!isGuest ? <PhaseChip phase={pollData?.phase} /> : null}
          />

          {isGuest ? (
            <GuestPollInvite onSignIn={() => router.push('/(auth)/login')} />
          ) : loadingPoll ? (
            <Card><LoadingState message="Loading today's poll…" compact /></Card>
          ) : pollError ? (
            <Card><ErrorState message={pollError} onRetry={loadPoll} /></Card>
          ) : (
            <PollCard
              data={pollData}
              submittingVote={submittingVote}
              submittingSpecial={submittingSpecial}
              onVote={handleVote}
              onSpecialCase={handleSpecialCase}
              onUndoSpecial={handleUndoSpecial}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// -------------------------------------------------------------------------
// PrayerCard — hero countdown + horizontal ribbon timeline
// -------------------------------------------------------------------------
function PrayerCard({ timeline, current, remainingMs, isFallback }) {
  const scrollRef = useRef(null);
  const nodePositions = useRef({});
  const screenWidth = Dimensions.get('window').width;

  // The ribbon node to bring into view: the prayer currently running, or
  // during the post-sunrise gap the one coming up next.
  const focusKey = current?.isGap ? 'dhuhr' : current?.key;

  useEffect(() => {
    if (!focusKey) return;
    const t = setTimeout(() => {
      const x = nodePositions.current[focusKey];
      if (x != null) {
        const targetX = Math.max(0, x - screenWidth * 0.28);
        scrollRef.current?.scrollTo({ x: targetX, animated: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [focusKey, screenWidth]);

  const { h, m, s } = splitDuration(remainingMs);
  // Progress through the current window, 0–1. During the gap this shows
  // how close Dhuhr is rather than how much of a prayer is left.
  const progress = current?.totalMs
    ? Math.min(1, Math.max(0, current.elapsedMs / current.totalMs))
    : 0;

  // Under five minutes left is the "hurry" state — the window is about
  // to close and that deserves visual weight rather than a quiet number.
  const isUrgent = !current?.isGap && remainingMs > 0 && remainingMs < 5 * 60_000;

  return (
    <Card padding={false}>
      {/* ---- Countdown hero -------------------------------------------- */}
      <View style={[styles.hero, isUrgent && styles.heroUrgent]}>
        <View style={styles.heroTopRow}>
          <View style={styles.heroEyebrowRow}>
            <RubStar size={11} />
            <Text style={[styles.heroEyebrow, isUrgent && styles.heroEyebrowUrgent]}>
              {current?.isGap ? 'Up next' : 'Current prayer'}
            </Text>
          </View>
          {!current?.isGap && current ? (
            <View style={[styles.liveBadge, isUrgent && styles.liveBadgeUrgent]}>
              <View style={[styles.livePulse, isUrgent && styles.livePulseUrgent]} />
              <Text style={[styles.liveBadgeText, isUrgent && styles.liveBadgeTextUrgent]}>
                In progress
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.heroPrayerName}>{current?.label || '—'}</Text>

        {/* Segmented live counter — ticks every second */}
        <Text style={[styles.heroCountLabel, isUrgent && styles.heroCountLabelUrgent]}>
          {current?.isGap ? 'Begins in' : 'Time left'}
        </Text>
        <View
          style={styles.counterRow}
          accessibilityRole="timer"
          accessibilityLabel={
            current
              ? `${current.isGap ? `${current.label} begins in` : `${current.label} ends in`} ${h} hours ${m} minutes ${s} seconds`
              : 'Prayer times unavailable'
          }
        >
          {h > 0 && (
            <>
              <CounterSegment value={h} unit="hr" urgent={isUrgent} />
              <Text style={[styles.counterColon, isUrgent && styles.counterColonUrgent]}>:</Text>
            </>
          )}
          <CounterSegment value={m} unit="min" urgent={isUrgent} pad={h > 0} />
          <Text style={[styles.counterColon, isUrgent && styles.counterColonUrgent]}>:</Text>
          <CounterSegment value={s} unit="sec" urgent={isUrgent} pad />
        </View>

        {/* Window progress — how far through this prayer's time we are */}
        {current ? (
          <View style={styles.progressWrap}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  isUrgent && styles.progressFillUrgent,
                  { width: `${Math.round(progress * 100)}%` },
                ]}
              />
            </View>
            <View style={styles.windowRow}>
              <Text style={styles.windowEdge}>{formatClock(current.start)}</Text>
              <Text style={styles.windowMid}>
                {current.isGap ? 'no prayer due' : 'window'}
              </Text>
              <Text style={styles.windowEdge}>{formatClock(current.end)}</Text>
            </View>
          </View>
        ) : null}
      </View>

      {/* ---- Ornament divider ------------------------------------------ */}
      <View style={styles.ornamentDivider}>
        <View style={styles.ornamentRule} />
        <RubStar size={11} />
        <View style={styles.ornamentRule} />
      </View>

      {/* ---- Horizontal timeline --------------------------------------- */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.timeline}
      >
        {timeline.map((row, i) => {
          // The prayer whose window is running right now gets the filled
          // marker. During the post-sunrise gap nothing is "current", so
          // we ring the upcoming Dhuhr instead.
          const isCurrent = !current?.isGap && current?.key === row.key;
          const isUpNext  = current?.isGap && row.key === 'dhuhr';
          const isPast    = row.isPast && !isCurrent && !isUpNext;
          const isFirst = i === 0;
          const isLast  = i === timeline.length - 1;

          const leadPastColored  = i > 0 && (timeline[i].isPast || isCurrent || isUpNext);
          const trailPastColored = i < timeline.length - 1 && timeline[i].isPast;

          return (
            <View
              key={row.key}
              style={styles.node}
              onLayout={(e) => { nodePositions.current[row.key] = e.nativeEvent.layout.x; }}
            >
              {/* Rail — left half + right half so each segment can be tinted */}
              <View style={styles.rail}>
                <View style={[
                  styles.railSegment,
                  isFirst && { opacity: 0 },
                  leadPastColored ? styles.railPast : styles.railFuture,
                ]} />
                <View style={[
                  styles.railSegment,
                  isLast && { opacity: 0 },
                  trailPastColored ? styles.railPast : styles.railFuture,
                ]} />
              </View>

              {/* Dot */}
              <View style={[
                styles.dot,
                isPast && styles.dotPast,
                isUpNext && styles.dotNext,
                isCurrent && styles.dotCurrent,
              ]}>
                {isCurrent && <View style={styles.dotCurrentInner} />}
                {isUpNext && <View style={styles.dotInner} />}
              </View>

              {/* Label + time */}
              <Text style={[
                styles.nodeLabel,
                (isCurrent || isUpNext) && styles.nodeLabelNext,
                isPast && styles.nodeLabelPast,
              ]} numberOfLines={1}>{row.label}</Text>
              <Text style={[
                styles.nodeTime,
                (isCurrent || isUpNext) && styles.nodeTimeNext,
                isPast && styles.nodeTimePast,
              ]} numberOfLines={1}>{format12h(row.time)}</Text>

              {/* Sunrise and the two Ramadan markers are not prayers —
                  a one-word caption stops them reading as one on a
                  timeline whose other nodes all are. */}
              {NON_PRAYER_NOTE[row.key] ? (
                <Text style={styles.nodeNote} numberOfLines={1}>{NON_PRAYER_NOTE[row.key]}</Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      {isFallback && (
        <View style={styles.calcHint}>
          <Ionicons name="calculator-outline" size={12} color={colors.inkFaint} />
          <Text style={styles.calcHintText}>Calculated locally — the online almanac was unreachable.</Text>
        </View>
      )}
    </Card>
  );
}

/**
 * One h/m/s block of the live counter. Tabular numerals keep the digits
 * from shifting horizontally as they tick, which is what makes a running
 * counter feel steady instead of twitchy.
 */
function CounterSegment({ value, unit, urgent, pad }) {
  return (
    <View style={styles.counterSegment}>
      <Text style={[styles.counterValue, urgent && styles.counterValueUrgent]}>
        {pad ? String(value).padStart(2, '0') : String(value)}
      </Text>
      <Text style={[styles.counterUnit, urgent && styles.counterUnitUrgent]}>{unit}</Text>
    </View>
  );
}

// -------------------------------------------------------------------------
// GuestPollInvite — shown in the poll slot when browsing without an
// account. Warm parchment tint + gold ornament so it reads as an
// invitation rather than a restriction.
// -------------------------------------------------------------------------
function GuestPollInvite({ onSignIn }) {
  return (
    <Card tone="warm">
      <View style={styles.inviteOrnamentRow}>
        <View style={styles.inviteOrnamentRule} />
        <RubStar size={12} />
        <View style={styles.inviteOrnamentRule} />
      </View>
      <Text style={styles.inviteTitle}>Join today's Sehri poll</Text>
      <Text style={styles.inviteBody}>
        Sign in to tell your zone whether you'll be having Sehri tomorrow —
        the kitchen prepares food for exactly the count they get from the poll.
      </Text>
      <Button
        label="Sign in to vote"
        onPress={onSignIn}
        icon="log-in-outline"
        fullWidth
        style={{ marginTop: space[4] }}
      />
    </Card>
  );
}

// -------------------------------------------------------------------------
// Small components
// -------------------------------------------------------------------------
function Wordmark() {
  return (
    <View style={styles.wordmarkRow}>
      <View style={styles.wordmarkDot} />
      <Text style={styles.wordmark}>OneMessage</Text>
    </View>
  );
}

function PhaseChip({ phase }) {
  const map = {
    [PHASE.VOTING]:       { tone: 'teal',    label: 'Voting open' },
    [PHASE.SPECIAL_CASE]: { tone: 'warn',    label: 'Special case window' },
    [PHASE.ALLOTMENT]:    { tone: 'gold',    label: 'Allotment' },
    [PHASE.STATUS]:       { tone: 'success', label: 'Final list' },
    [PHASE.CLOSED]:       { tone: 'neutral', label: 'Closed' },
  };
  const cfg = map[phase] || map[PHASE.CLOSED];
  return <Chip label={cfg.label} tone={cfg.tone} />;
}

function PollCard({ data, submittingVote, submittingSpecial, onVote, onSpecialCase, onUndoSpecial }) {
  const phase = data?.phase || PHASE.CLOSED;
  const poll = data?.poll;
  const my = data?.my_response;

  if (!poll) {
    return (
      <Card>
        <Text style={styles.pollHeadline}>No poll scheduled for today.</Text>
        <Text style={styles.pollBody}>The next poll opens at 10 pm.</Text>
      </Card>
    );
  }

  if (phase === PHASE.VOTING) {
    return (
      <Card>
        <Text style={styles.pollHeadline}>Will you be having Sehri tomorrow?</Text>
        <Text style={styles.pollBody}>Voting closes at 10:00 am.</Text>
        {my ? (
          <View style={styles.votedRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.votedText}>
              You voted <Text style={styles.votedValue}>{my.response?.toLowerCase()}</Text>.
            </Text>
          </View>
        ) : (
          <View style={styles.voteButtons}>
            <Button label="Yes, count me in" onPress={() => onVote('yes')} loading={submittingVote} fullWidth />
            <Button label="No, not tomorrow" variant="secondary" onPress={() => onVote('no')} loading={submittingVote} fullWidth style={{ marginTop: space[2] }} />
          </View>
        )}
      </Card>
    );
  }

  if (phase === PHASE.SPECIAL_CASE) {
    // 1. User already raised a special case → show status + Undo (if
    //    still pending — super admin hasn't reviewed yet).
    if (my?.is_special_case) {
      const requestedLabel = my.special_case_type === 'want'
        ? 'You asked to be added'
        : 'You asked to be removed';
      const notYetReviewed = my.sehri_allowed === null;

      return (
        <Card>
          <Text style={styles.pollHeadline}>Your special case is in.</Text>
          <Text style={styles.pollBody}>{requestedLabel}. The super admin reviews it between 5 pm and 6 pm.</Text>

          {notYetReviewed ? (
            <View style={styles.voteButtons}>
              <Button
                label="Undo request"
                variant="secondary"
                icon="arrow-undo-outline"
                onPress={() => {
                  Alert.alert(
                    'Undo special case?',
                    "You'll go back to your original vote. You can raise a new special case again before 5 pm.",
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Undo', style: 'destructive', onPress: onUndoSpecial },
                    ]
                  );
                }}
                loading={submittingSpecial}
                fullWidth
              />
            </View>
          ) : (
            <View style={[
              styles.outcomeRow,
              my.sehri_allowed === 'approved' ? styles.outcomeApproved : styles.outcomeRejected,
            ]}>
              <Ionicons
                name={my.sehri_allowed === 'approved' ? 'checkmark-circle' : 'close-circle'}
                size={16}
                color={my.sehri_allowed === 'approved' ? colors.success : colors.danger}
              />
              <Text style={[
                styles.outcomeText,
                { color: my.sehri_allowed === 'approved' ? colors.success : colors.danger },
              ]}>
                Special case {my.sehri_allowed}
              </Text>
            </View>
          )}
        </Card>
      );
    }

    // 2. User voted but hasn't raised a special case → let them opt out
    //    (if they voted yes) or opt in (if they voted no).
    if (my?.response) {
      const isYes = my.response === 'yes';
      const type       = isYes ? 'dont_want' : 'want';
      const headline   = isYes
        ? 'Plans changed? Skip Sehri.'
        : "Actually, please count me in.";
      const body       = isYes
        ? "You said yes, but if you can't make it, tell the kitchen now so food isn't prepared for you."
        : "You said no, but if you'd like Sehri after all, raise a special case before 5 pm.";
      const buttonLabel = isYes ? 'Remove me from the list' : 'Add me to the list';

      const confirmAndSubmit = () => {
        Alert.alert(
          isYes ? 'Skip Sehri tomorrow?' : 'Add yourself back in?',
          isYes
            ? "The kitchen will exclude you if the super admin approves."
            : "The kitchen will include you if the super admin approves.",
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Send request', onPress: () => onSpecialCase(type) },
          ]
        );
      };

      return (
        <Card>
          <Text style={styles.pollHeadline}>{headline}</Text>
          <Text style={styles.pollBody}>{body}</Text>
          <View style={styles.voteButtons}>
            <Button
              label={buttonLabel}
              onPress={confirmAndSubmit}
              icon={isYes ? 'remove-circle-outline' : 'add-circle-outline'}
              loading={submittingSpecial}
              variant={isYes ? 'secondary' : 'primary'}
              fullWidth
            />
          </View>
          <Text style={styles.footnote}>Requests close at 5 pm. Review happens 5–6 pm.</Text>
        </Card>
      );
    }

    // 3. User didn't vote at all — nothing to change.
    return (
      <Card>
        <Text style={styles.pollHeadline}>You didn't vote today.</Text>
        <Text style={styles.pollBody}>
          Only users who voted can raise a special case. Voting reopens at 10 pm for tomorrow's Sehri.
        </Text>
      </Card>
    );
  }

  if (phase === PHASE.ALLOTMENT) {
    return (
      <Card>
        <Text style={styles.pollHeadline}>Allotment in progress</Text>
        <Text style={styles.pollBody}>Special cases are being reviewed. The final list will be up by 6 pm.</Text>
        {my?.sehri_allowed && (
          <View style={[
            styles.outcomeRow,
            my.sehri_allowed === 'approved' ? styles.outcomeApproved : styles.outcomeRejected,
          ]}>
            <Ionicons
              name={my.sehri_allowed === 'approved' ? 'checkmark-circle' : 'close-circle'}
              size={16}
              color={my.sehri_allowed === 'approved' ? colors.success : colors.danger}
            />
            <Text style={[
              styles.outcomeText,
              { color: my.sehri_allowed === 'approved' ? colors.success : colors.danger },
            ]}>
              Special case {my.sehri_allowed}
            </Text>
          </View>
        )}
      </Card>
    );
  }

  if (phase === PHASE.STATUS) {
    return (
      <Card>
        <Text style={styles.pollHeadline}>The list is confirmed.</Text>
        <Text style={styles.pollBody}>Delivery begins in the early morning.</Text>
        {my && (
          <View style={styles.finalRow}>
            <Text style={styles.finalKey}>Your vote</Text>
            <Text style={styles.finalVal}>{my.response?.toLowerCase()}</Text>
            {my.sehri_allowed ? (
              <Chip
                label={my.sehri_allowed === 'approved' ? 'Special case approved' : 'Special case rejected'}
                tone={my.sehri_allowed === 'approved' ? 'success' : 'danger'}
                style={{ marginLeft: space[2] }}
              />
            ) : null}
          </View>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <Text style={styles.pollHeadline}>Voting is closed for now.</Text>
      <Text style={styles.pollBody}>Voting reopens at 10 pm. Special cases run 10 am to 5 pm.</Text>
      {my && (
        <View style={styles.finalRow}>
          <Text style={styles.finalKey}>Your last vote</Text>
          <Text style={styles.finalVal}>{my.response?.toLowerCase()}</Text>
        </View>
      )}
    </Card>
  );
}

// =========================================================================
// Styles
// =========================================================================
const NODE_WIDTH = 84;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { paddingBottom: space[8] },

  // Wordmark
  wordmarkRow: { flexDirection: 'row', alignItems: 'center' },
  wordmarkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal, marginRight: space[2] },
  wordmark:    { fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },

  // Role switcher
  roleRow:    { paddingHorizontal: space[5], paddingBottom: space[3], gap: space[2] },
  roleLabel:  { ...type.meta, color: colors.inkFaint },
  roleChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },

  // Section wrapper
  section:    { paddingHorizontal: space[4], paddingTop: space[4] },

  // ---- Prayer HERO ------------------------------------------------------
  hero: {
    paddingHorizontal: space[5],
    paddingTop: space[4],
    paddingBottom: space[4],
    backgroundColor: colors.tealSoft,
    borderBottomWidth: 0,
  },
  // Urgent = under 5 minutes of the window left. Warm amber wash rather
  // than red: the window closing is a nudge, not an error.
  heroUrgent:      { backgroundColor: colors.warnSoft },

  heroTopRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroEyebrowRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  heroEyebrow:     { ...type.micro, color: colors.tealDark, fontWeight: '700' },
  heroEyebrowUrgent: { color: colors.warn },
  heroPrayerName:  { fontSize: 30, fontWeight: '800', color: colors.ink, letterSpacing: -0.5, marginBottom: space[3] },

  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.tealBorder,
    borderRadius: radius.pill,
    paddingHorizontal: space[2], paddingVertical: 3,
  },
  liveBadgeUrgent:     { borderColor: colors.warn },
  livePulse:           { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.teal },
  livePulseUrgent:     { backgroundColor: colors.warn },
  liveBadgeText:       { ...type.micro, color: colors.tealDark, fontWeight: '700' },
  liveBadgeTextUrgent: { color: colors.warn },

  heroCountLabel:       { ...type.micro, color: colors.inkFaint, fontWeight: '700', marginBottom: 2 },
  heroCountLabelUrgent: { color: colors.warn },

  // Segmented running counter
  counterRow:     { flexDirection: 'row', alignItems: 'flex-end' },
  counterSegment: { alignItems: 'center', minWidth: 46 },
  counterValue: {
    fontSize: 38,
    fontWeight: '800',
    color: colors.tealDark,
    letterSpacing: -1,
    // Tabular numerals stop the digits jittering sideways each tick.
    fontVariant: ['tabular-nums'],
    lineHeight: 42,
  },
  counterValueUrgent: { color: colors.warn },
  counterUnit:        { ...type.micro, color: colors.inkFaint, fontWeight: '700', marginTop: -2 },
  counterUnitUrgent:  { color: colors.warn },
  counterColon: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.tealBorder,
    marginHorizontal: 2,
    lineHeight: 42,
  },
  counterColonUrgent: { color: colors.warn, opacity: 0.5 },

  // Window progress bar
  progressWrap:  { marginTop: space[4] },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    overflow: 'hidden',
  },
  progressFill:       { height: '100%', backgroundColor: colors.teal, borderRadius: 3 },
  progressFillUrgent: { backgroundColor: colors.warn },
  windowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  windowEdge: { ...type.micro, color: colors.inkFaint, fontVariant: ['tabular-nums'] },
  windowMid:  { ...type.micro, color: colors.inkGhost, fontStyle: 'italic' },

  // ---- Ornament divider between hero + ribbon --------------------------
  ornamentDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[6],
    paddingVertical: space[3],
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.tealBorder,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleFaint,
  },
  ornamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },

  // ---- Horizontal ribbon timeline --------------------------------------
  timeline: {
    paddingHorizontal: space[2],
    paddingTop: space[5],
    paddingBottom: space[5],
    backgroundColor: colors.paper,
  },
  node: {
    width: NODE_WIDTH,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 12, // room for the rail + dot
    position: 'relative',
  },
  // Rail: two halves so past/future can be tinted independently
  rail: {
    position: 'absolute',
    top: 22,
    left: 0,
    right: 0,
    height: 2,
    flexDirection: 'row',
  },
  railSegment: { flex: 1, height: 2 },
  railPast:    { backgroundColor: colors.tealBorder },
  railFuture:  { backgroundColor: colors.ruleSoft },

  // Dot styles
  dot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.paper,
    borderWidth: 2, borderColor: colors.ruleSoft,
    marginBottom: space[3],
    zIndex: 1,
  },
  dotPast: {
    backgroundColor: colors.tealBorder,
    borderColor: colors.tealBorder,
  },
  // "Up next" — hollow gold ring. Used during the post-sunrise gap.
  dotNext: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.paper,
    borderWidth: 2, borderColor: colors.gold,
    marginTop: -3,
    marginBottom: space[3] - 3,
    alignItems: 'center', justifyContent: 'center',
    // subtle glow ring
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 2,
  },
  dotInner: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.teal,
  },
  // "Currently running" — filled teal with a gold ring. Deliberately the
  // heaviest marker on the ribbon: it's the answer to the question the
  // user opened this screen to ask.
  dotCurrent: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.teal,
    borderWidth: 2.5, borderColor: colors.gold,
    marginTop: -4,
    marginBottom: space[3] - 4,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.teal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 3,
  },
  dotCurrentInner: {
    width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: colors.paper,
  },

  // Node text
  nodeLabel:     { ...type.meta, color: colors.inkMuted, fontWeight: '600', textAlign: 'center' },
  nodeLabelNext: { color: colors.tealDark, fontWeight: '800' },
  nodeLabelPast: { color: colors.inkFaint, fontWeight: '500' },
  nodeTime:      { ...type.micro, color: colors.inkFaint, textAlign: 'center', marginTop: 2, fontVariant: ['tabular-nums'] },
  nodeTimeNext:  { color: colors.tealDark, fontWeight: '700' },
  nodeTimePast:  { color: colors.inkGhost },
  nodeNote:      { ...type.micro, color: colors.inkGhost, textAlign: 'center', marginTop: 1, fontSize: 9, fontStyle: 'italic' },

  // Fallback hint
  calcHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  calcHintText: { ...type.micro, fontWeight: '500', color: colors.inkFaint },

  // ---- Poll ------------------------------------------------------------
  pollHeadline: { ...type.h3, marginBottom: space[1] },
  pollBody:     { ...type.body, marginBottom: space[3] },

  voteButtons:  { marginTop: space[2] },
  votedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.successSoft,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderRadius: radius.md,
  },
  votedText:  { ...type.body, color: colors.ink },
  votedValue: { fontWeight: '800' },

  finalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space[2],
  },
  finalKey: { ...type.meta, color: colors.inkFaint, marginRight: space[2] },
  finalVal: { ...type.bodyStrong, textTransform: 'lowercase' },

  outcomeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  outcomeApproved: { backgroundColor: colors.successSoft },
  outcomeRejected: { backgroundColor: colors.dangerSoft },
  outcomeText:     { ...type.meta, fontWeight: '700' },
  footnote:        { ...type.micro, color: colors.inkFaint, marginTop: space[3], textAlign: 'center' },

  // Guest poll invite
  inviteOrnamentRow:  { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3] },
  inviteOrnamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },
  inviteTitle:        { ...type.h3, color: colors.ink, marginBottom: space[2] },
  inviteBody:         { ...type.body, color: colors.inkMuted, lineHeight: 22 },
});
