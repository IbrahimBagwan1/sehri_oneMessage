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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
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
 * The "next" prayer is the future one with the SMALLEST timestamp.
 *
 * Historical bug we must never reintroduce: previous versions did
 * `timeline.find(r => !r.isPast)`, which returns the first array element
 * that isn't past — not the earliest in time. Because Tahajjud sits at
 * index 0 and (once today's has passed) rolls forward to tomorrow's
 * ~2 AM, it was *always* in the future and *always* won the "next" slot,
 * regardless of whether Dhuhr, Asr, Maghrib, or Isha were coming up
 * sooner today. Sort by absolute `at` here — never by array order.
 *
 * Verified edge cases:
 *   • right before Fajr (04:45) → next = Imsak
 *   • right after Isha (21:30)  → next = Tahajjud (tomorrow ~02:14)
 *   • during Tahajjud   (02:30) → next = Imsak (later today)
 *   • right after midnight (00:15) → next = Tahajjud (later today ~02:14)
 *
 * Fallback: if for some reason every row is past (missing tahajjud_time
 * plus everything else has passed), roll tomorrow's Fajr forward so the
 * countdown never shows a negative gap.
 */
const findNext = (timeline) => {
  if (!timeline || timeline.length === 0) return null;
  const future = timeline
    .filter((r) => !r.isPast)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (future.length > 0) return future[0];

  const first = timeline.find((r) => r.key === 'fajr') ||
                timeline.find((r) => !r.extended) ||
                timeline[0];
  const rollover = new Date(first.at.getTime() + DAY_MS);
  return { ...first, at: rollover, isPast: false };
};

/**
 * Adaptive formatting: hours + minutes when far off, minutes + seconds
 * inside the last hour, seconds only inside the last minute. Keeps the
 * seconds counter from feeling jittery when a prayer is hours away.
 */
const formatCountdown = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
};

// -------------------------------------------------------------------------
// Live countdown hook — self-adjusting tick rate.
//   - >5 min out: tick every 30s (minute precision anyway)
//   - >1 hour out: tick every 60s
//   - <5 min out: tick every 1s
// Cuts wasted renders 60x/min → 2x/min for most of the day.
// -------------------------------------------------------------------------
const useCountdown = (targetMs) => {
  const [, force] = useState(0);
  useEffect(() => {
    if (!targetMs) return undefined;
    const tick = () => {
      const remaining = targetMs - Date.now();
      let interval;
      if (remaining <= 0) interval = 60_000;
      else if (remaining < 5 * 60_000) interval = 1_000;
      else if (remaining < 60 * 60_000) interval = 60_000;
      else interval = 60_000;
      force((n) => n + 1);
      return interval;
    };
    let handle;
    const schedule = () => {
      const next = tick();
      handle = setTimeout(schedule, next);
    };
    schedule();
    return () => clearTimeout(handle);
  }, [targetMs]);
  return targetMs ? Math.max(0, targetMs - Date.now()) : 0;
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

  const firstName = useMemo(() => {
    if (isGuest) return 'friend';
    return (user?.name || 'Friend').trim().split(/\s+/)[0];
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
  const nextPrayer = useMemo(() => findNext(timeline), [timeline]);
  const remainingMs = useCountdown(nextPrayer?.at?.getTime());

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
          name={isGuest ? 'to OneMessage' : firstName}
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
              nextPrayer={nextPrayer}
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
function PrayerCard({ timeline, nextPrayer, remainingMs, isFallback }) {
  const scrollRef = useRef(null);
  const nodePositions = useRef({});
  const screenWidth = Dimensions.get('window').width;

  // Auto-scroll horizontally so the "next" node sits ~1/3 from the left,
  // giving the reader both past context and what's coming next.
  useEffect(() => {
    if (!nextPrayer?.key) return;
    const t = setTimeout(() => {
      const x = nodePositions.current[nextPrayer.key];
      if (x != null) {
        const targetX = Math.max(0, x - screenWidth * 0.28);
        scrollRef.current?.scrollTo({ x: targetX, animated: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [nextPrayer?.key, screenWidth]);

  return (
    <Card padding={false}>
      {/* ---- Countdown hero -------------------------------------------- */}
      <View style={styles.hero}>
        <View style={styles.heroEyebrowRow}>
          <RubStar size={11} />
          <Text style={styles.heroEyebrow}>Next prayer</Text>
        </View>
        <Text style={styles.heroPrayerName}>{nextPrayer?.label || '—'}</Text>

        <View style={styles.heroCountdownRow}>
          <Text style={styles.heroCountdown}>{formatCountdown(remainingMs)}</Text>
          <View style={styles.heroDivider} />
          <View>
            <Text style={styles.heroAtLabel}>at</Text>
            <Text style={styles.heroAtTime}>{format12h(nextPrayer?.time)}</Text>
          </View>
        </View>
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
          const isNext = nextPrayer && row.key === nextPrayer.key;
          const isPast = row.isPast && !isNext;
          const isFirst = i === 0;
          const isLast  = i === timeline.length - 1;

          // Segment leading INTO this node is "past" when the current
          // node is past OR is the next-upcoming one.
          const leadPastColored  = i > 0 && (timeline[i].isPast || isNext);
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
                isNext && styles.dotNext,
              ]}>
                {isNext && <View style={styles.dotInner} />}
              </View>

              {/* Label + time */}
              <Text style={[
                styles.nodeLabel,
                isNext && styles.nodeLabelNext,
                isPast && styles.nodeLabelPast,
              ]} numberOfLines={1}>{row.label}</Text>
              <Text style={[
                styles.nodeTime,
                isNext && styles.nodeTimeNext,
                isPast && styles.nodeTimePast,
              ]} numberOfLines={1}>{format12h(row.time)}</Text>
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
  heroEyebrowRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  heroEyebrow:     { ...type.micro, color: colors.tealDark, fontWeight: '700' },
  heroPrayerName:  { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4, marginBottom: space[3] },

  heroCountdownRow:{ flexDirection: 'row', alignItems: 'center', gap: space[3] },
  heroCountdown:   {
    fontSize: 32,
    fontWeight: '800',
    color: colors.tealDark,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  heroDivider:     { width: 1, height: 32, backgroundColor: colors.tealBorder },
  heroAtLabel:     { ...type.micro, color: colors.inkFaint, fontWeight: '600' },
  heroAtTime:      { ...type.bodyStrong, color: colors.tealDark, marginTop: 2, fontVariant: ['tabular-nums'] },

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

  // Node text
  nodeLabel:     { ...type.meta, color: colors.inkMuted, fontWeight: '600', textAlign: 'center' },
  nodeLabelNext: { color: colors.tealDark, fontWeight: '800' },
  nodeLabelPast: { color: colors.inkFaint, fontWeight: '500' },
  nodeTime:      { ...type.micro, color: colors.inkFaint, textAlign: 'center', marginTop: 2, fontVariant: ['tabular-nums'] },
  nodeTimeNext:  { color: colors.tealDark, fontWeight: '700' },
  nodeTimePast:  { color: colors.inkGhost },

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
