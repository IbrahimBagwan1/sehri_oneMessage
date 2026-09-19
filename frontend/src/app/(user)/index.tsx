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
// -------------------------------------------------------------------------

const parseHM = (t) => {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map((n) => Number.parseInt(n, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? { h, m } : null;
};

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
 * Turn the AlAdhan response into the ordered ribbon shape.
 * Each row: { key, label, time, at (Date), isPast, extended }.
 */
const buildTimeline = (data) => {
  if (!data) return [];
  const now = new Date();
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

  return PRAYER_TIMELINE
    .map((row) => {
      const time = source[row.key];
      const hm = parseHM(time);
      if (!hm) return null;
      const at = new Date(now);
      at.setHours(hm.h, hm.m, 0, 0);
      // Tahajjud typically falls in the last third of the night (2 am-ish),
      // which the API returns as "02:14" — that's tomorrow's, not today's.
      // If the resulting timestamp is *before* now AND the label is
      // tahajjud, treat it as tomorrow so the countdown makes sense.
      if (row.key === 'tahajjud' && at < now) {
        at.setDate(at.getDate() + 1);
      }
      return { ...row, time, at, isPast: at < now };
    })
    .filter(Boolean);
};

/**
 * The "next" prayer is the earliest one whose time hasn't passed yet.
 * If everything has passed (late night before Tahajjud rolls over), we
 * roll to tomorrow's Fajr so the countdown never shows a negative gap.
 */
const findNext = (timeline) => {
  const upcoming = timeline.find((r) => !r.isPast);
  if (upcoming) return upcoming;
  const first = timeline.find((r) => !r.extended) || timeline[0];
  if (!first) return null;
  const rollover = new Date(first.at);
  rollover.setDate(rollover.getDate() + 1);
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
  const available_roles = useAuthStore((s) => s.available_roles);
  const switchRole      = useAuthStore((s) => s.switchRole);

  const [prayerData,    setPrayerData]  = useState<any>(null);
  const [pollData,      setPollData]    = useState<any>(null);
  const [loadingPrayer, setLoadingP]    = useState(true);
  const [loadingPoll,   setLoadingV]    = useState(true);
  const [prayerError,   setPrayerErr]   = useState<string | null>(null);
  const [pollError,     setPollErr]     = useState<string | null>(null);
  const [submittingVote, setSubmitting] = useState(false);
  const [refreshing,    setRefreshing]  = useState(false);

  const firstName = useMemo(() => (user?.name || 'Friend').trim().split(/\s+/)[0], [user?.name]);

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
    setPollErr(null);
    try {
      const res = await pollsApi.getActive();
      if (res.success) setPollData(res.data);
    } catch {
      setPollErr("Couldn't load today's Sehri poll.");
    } finally {
      setLoadingV(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadPrayer();
    loadPoll();
    const t = setInterval(loadPoll, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [loadPrayer, loadPoll]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadPrayer(), loadPoll()]);
    setRefreshing(false);
  }, [loadPrayer, loadPoll]);

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
          <Avatar
            name={user?.name}
            size={38}
            onPress={() => router.push('/profile')}
            accessibilityLabel="Open profile"
          />
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
          greeting="Assalamu alaikum"
          name={firstName}
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
            trailing={<PhaseChip phase={pollData?.phase} />}
          />

          {loadingPoll ? (
            <Card><LoadingState message="Loading today's poll…" compact /></Card>
          ) : pollError ? (
            <Card><ErrorState message={pollError} onRetry={loadPoll} /></Card>
          ) : (
            <PollCard data={pollData} submittingVote={submittingVote} onVote={handleVote} />
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

function PollCard({ data, submittingVote, onVote }) {
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
    if (my?.is_special_case) {
      return (
        <Card>
          <Text style={styles.pollHeadline}>Your special case is in.</Text>
          <Text style={styles.pollBody}>
            The super admin will review it before 6 pm. You'll see the outcome here.
          </Text>
        </Card>
      );
    }
    return (
      <Card>
        <Text style={styles.pollHeadline}>Plans changed for Sehri?</Text>
        <Text style={styles.pollBody}>
          Special-case requests are open from 10 am to 5 pm. Contact your zone admin
          if you need to add or drop yourself.
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
});
