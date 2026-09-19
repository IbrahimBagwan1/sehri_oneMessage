// @ts-nocheck
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
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
  Divider,
  ErrorState,
  Header,
  Hero,
  LoadingState,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// ==========================================
// Constants — kept in one place so the poll card and prayer card don't
// grow one-off literals over time.
// ==========================================
const PHASE = {
  VOTING:       'voting',
  SPECIAL_CASE: 'special_case',
  ALLOTMENT:    'allotment',
  STATUS:       'status',
  CLOSED:       'closed',
};

// Prayer names in the order they occur through the day — used to derive
// "which prayer is next?" from the AlAdhan timings map.
const PRAYER_ORDER = [
  { key: 'fajr',     label: 'Fajr'     },
  { key: 'sunrise',  label: 'Sunrise'  },
  { key: 'dhuhr',    label: 'Dhuhr'    },
  { key: 'asr',      label: 'Asr'      },
  { key: 'maghrib',  label: 'Maghrib'  },
  { key: 'isha',     label: 'Isha'     },
];

// Extra rows shown in the full list (Tahajjud + Imsak sit outside the
// six daily prayers but matter for the community's rhythm during Ramadan).
const EXTENDED_ROWS = [
  { key: 'tahajjud', label: 'Tahajjud', hint: 'Last third of the night' },
  { key: 'imsak',    label: 'Imsak',    hint: 'Fasting begins' },
];

// -------------------------------------------------------------------------
// Small local helpers — all pure, all deterministic.
// -------------------------------------------------------------------------

/** "22:30" → 22 * 60 + 30 = 1350; null-safe. */
const toMinutes = (t) => {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

/** Format an HH:MM string in either 12h or 24h — 12h preferred for the UI. */
const formatTime = (t) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return t;
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

/** "in 34m" / "in 2h 15m" — human-friendly gap to a moment later today. */
const relative = (minsFromNow) => {
  if (minsFromNow == null || minsFromNow < 0) return null;
  if (minsFromNow < 1) return 'now';
  if (minsFromNow < 60) return `in ${minsFromNow}m`;
  const h = Math.floor(minsFromNow / 60);
  const m = minsFromNow % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
};

/** "Wednesday, 19 September" */
const gregorianLine = () =>
  new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long',
  });

// -------------------------------------------------------------------------
// Screen
// -------------------------------------------------------------------------
export default function HomeScreen() {
  const router          = useRouter();
  const user            = useAuthStore((s) => s.user);
  const available_roles = useAuthStore((s) => s.available_roles);
  const switchRole      = useAuthStore((s) => s.switchRole);

  const [prayerData,   setPrayerData]  = useState<any>(null);   // full API response
  const [pollData,     setPollData]    = useState<any>(null);   // { poll, phase, my_response }
  const [loadingPrayer, setLoadingP]   = useState(true);
  const [loadingPoll,   setLoadingV]   = useState(true);
  const [prayerError,   setPrayerErr]  = useState<string | null>(null);
  const [pollError,     setPollErr]    = useState<string | null>(null);
  const [submittingVote, setSubmitting] = useState(false);
  const [refreshing,    setRefreshing] = useState(false);
  const [nowMins, setNowMins] = useState(getMinutesNow());

  const firstName = useMemo(() => (user?.name || 'Friend').trim().split(/\s+/)[0], [user?.name]);

  // ---------------------------------------------------------------------
  // Data loading — one function per resource. Errors are captured
  // per-resource so a prayer-timings hiccup doesn't blank the poll card.
  // ---------------------------------------------------------------------
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

  // Refetch on focus, and refresh the poll every 5 min while focused so
  // phase changes (10 pm → voting, 10 am → special case, etc.) are picked
  // up without the user having to reopen the tab.
  useFocusEffect(
    useCallback(() => {
      loadPrayer();
      loadPoll();
      const pollInterval = setInterval(loadPoll, 5 * 60 * 1000);
      return () => clearInterval(pollInterval);
    }, [loadPrayer, loadPoll])
  );

  // Tick every 60s so the "in Xm" label on the next prayer stays live.
  useEffect(() => {
    const t = setInterval(() => setNowMins(getMinutesNow()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadPrayer(), loadPoll()]);
    setRefreshing(false);
  }, [loadPrayer, loadPoll]);

  // ---------------------------------------------------------------------
  // Actions — poll vote + role switch
  // ---------------------------------------------------------------------
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

  // ---------------------------------------------------------------------
  // Derived — the "next prayer" the highlight card renders
  // ---------------------------------------------------------------------
  const prayerRows = useMemo(() => buildPrayerRows(prayerData), [prayerData]);
  const nextPrayer = useMemo(
    () => prayerRows.find((r) => r.minutes != null && r.minutes >= nowMins) || prayerRows[0] || null,
    [prayerRows, nowMins]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* ---------- Header ---------- */}
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
        {/* ---------- Salaam hero ---------- */}
        <Hero
          greeting="Assalamu alaikum"
          name={firstName}
          dateLine={buildDateLine(prayerData?.date_hijri)}
        />

        {/* ---------- Role switcher (only when the user actually has other roles) ---------- */}
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

        {/* ---------- Prayer times ---------- */}
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
          ) : (
            <Card padding={false}>
              {/* Highlighted "next" strip */}
              {nextPrayer && (
                <View style={styles.nextStrip}>
                  <View style={styles.nextLeft}>
                    <Text style={styles.nextEyebrow}>Next</Text>
                    <Text style={styles.nextLabel}>{nextPrayer.label}</Text>
                    {nextPrayer.hint ? <Text style={styles.nextHint}>{nextPrayer.hint}</Text> : null}
                  </View>
                  <View style={styles.nextRight}>
                    <Text style={styles.nextTime}>{formatTime(nextPrayer.time)}</Text>
                    {(() => {
                      const rel = nextPrayer.minutes != null ? relative(nextPrayer.minutes - nowMins) : null;
                      return rel ? <Text style={styles.nextRelative}>{rel}</Text> : null;
                    })()}
                  </View>
                </View>
              )}

              {/* Compact schedule of the whole day */}
              <View style={styles.dayList}>
                {prayerRows.map((row, i) => {
                  const isNext = nextPrayer && row.key === nextPrayer.key;
                  const isPast = row.minutes != null && row.minutes < nowMins && !isNext;
                  return (
                    <React.Fragment key={row.key}>
                      {i > 0 && <Divider tone="faint" />}
                      <View style={styles.dayRow}>
                        <Text style={[
                          styles.dayLabel,
                          isNext && styles.dayLabelActive,
                          isPast && styles.dayLabelPast,
                        ]}>
                          {row.label}
                        </Text>
                        <Text style={[
                          styles.dayTime,
                          isNext && styles.dayTimeActive,
                          isPast && styles.dayTimePast,
                        ]}>
                          {formatTime(row.time)}
                        </Text>
                      </View>
                    </React.Fragment>
                  );
                })}
              </View>

              {prayerData?.is_from_api === false && (
                <View style={styles.calcHint}>
                  <Ionicons name="calculator-outline" size={12} color={colors.inkFaint} />
                  <Text style={styles.calcHintText}>Calculated locally — the online almanac was unreachable.</Text>
                </View>
              )}
            </Card>
          )}
        </View>

        {/* ---------- Sehri poll ---------- */}
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
            <PollCard
              data={pollData}
              submittingVote={submittingVote}
              onVote={handleVote}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// -------------------------------------------------------------------------
// Sub-components
// -------------------------------------------------------------------------

/** Wordmark used as the header's `leading` on tab-root screens. */
function Wordmark() {
  return (
    <View style={styles.wordmarkRow}>
      <View style={styles.wordmarkDot} />
      <Text style={styles.wordmark}>OneMessage</Text>
    </View>
  );
}

/** Small colored chip mapping the poll's current phase. */
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

/**
 * PollCard — phase-dependent content inside a single flat card.
 * Every phase renders the same card shell so the visual weight is
 * consistent as the day rolls through.
 */
function PollCard({ data, submittingVote, onVote }) {
  const phase = data?.phase || PHASE.CLOSED;
  const poll = data?.poll;
  const my = data?.my_response;

  // No poll for today at all
  if (!poll) {
    return (
      <Card>
        <Text style={styles.pollHeadline}>No poll scheduled for today.</Text>
        <Text style={styles.pollBody}>The next poll opens at 10 pm.</Text>
      </Card>
    );
  }

  // Voting phase — biggest reason someone opens the home tab
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
            <Button
              label="Yes, count me in"
              variant="primary"
              onPress={() => onVote('yes')}
              loading={submittingVote}
              fullWidth
            />
            <Button
              label="No, not tomorrow"
              variant="secondary"
              onPress={() => onVote('no')}
              loading={submittingVote}
              fullWidth
              style={{ marginTop: space[2] }}
            />
          </View>
        )}
      </Card>
    );
  }

  // Special-case window
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

  // Allotment (super admin is reviewing between 5–6 pm)
  if (phase === PHASE.ALLOTMENT) {
    return (
      <Card>
        <Text style={styles.pollHeadline}>Allotment in progress</Text>
        <Text style={styles.pollBody}>Special cases are being reviewed. The final list will be up by 6 pm.</Text>
        {my?.sehri_allowed && (
          <SpecialCaseOutcome outcome={my.sehri_allowed} />
        )}
      </Card>
    );
  }

  // Status window (6 pm – 10 pm)
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

  // Closed
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

function SpecialCaseOutcome({ outcome }) {
  const approved = outcome === 'approved';
  return (
    <View style={[styles.outcomeRow, approved ? styles.outcomeApproved : styles.outcomeRejected]}>
      <Ionicons
        name={approved ? 'checkmark-circle' : 'close-circle'}
        size={16}
        color={approved ? colors.success : colors.danger}
      />
      <Text style={[styles.outcomeText, { color: approved ? colors.success : colors.danger }]}>
        Special case {outcome}
      </Text>
    </View>
  );
}

// -------------------------------------------------------------------------
// Pure helpers (kept at the bottom so the JSX flow reads top-to-bottom)
// -------------------------------------------------------------------------

function getMinutesNow() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Turn the API's timings blob into a stable, ordered list the UI can
 * render. Includes tahajjud + imsak at the top, then the six daily
 * prayers in canonical order.
 */
function buildPrayerRows(data) {
  if (!data) return [];
  const t = data.timings || {};
  const rows = [];

  if (data.tahajjud_time) {
    rows.push({ ...EXTENDED_ROWS[0], time: data.tahajjud_time, minutes: toMinutes(data.tahajjud_time) });
  }
  if (data.imsak_time || t.Imsak) {
    const time = data.imsak_time || t.Imsak;
    rows.push({ ...EXTENDED_ROWS[1], time, minutes: toMinutes(time) });
  }
  for (const p of PRAYER_ORDER) {
    const time = t[capitalize(p.key)];
    rows.push({ ...p, time, minutes: toMinutes(time) });
  }
  return rows;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "15 Ramadan 1447 · Wednesday, 19 September" — with a graceful fallback
 * to just the Gregorian half if Hijri came back null (local fallback).
 */
function buildDateLine(hijri) {
  const g = gregorianLine();
  return hijri ? `${hijri} · ${g}` : g;
}

// -------------------------------------------------------------------------
// Styles
// -------------------------------------------------------------------------
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { paddingBottom: space[8] },

  // Wordmark shown in the header slot on tab-root screens.
  wordmarkRow: { flexDirection: 'row', alignItems: 'center' },
  wordmarkDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.teal, marginRight: space[2],
  },
  wordmark: { fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },

  // Role switcher
  roleRow: {
    paddingHorizontal: space[5],
    paddingBottom: space[3],
    gap: space[2],
  },
  roleLabel: { ...type.meta, color: colors.inkFaint },
  roleChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },

  // Section wrapper
  section: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },

  // Next-prayer strip inside the prayer card
  nextStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space[4],
    backgroundColor: colors.tealSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleFaint,
  },
  nextLeft:     { flex: 1 },
  nextEyebrow:  { ...type.micro, color: colors.tealDark, fontWeight: '700' },
  nextLabel:    { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 2 },
  nextHint:     { ...type.meta, color: colors.inkFaint, marginTop: 2 },
  nextRight:    { alignItems: 'flex-end' },
  nextTime:     { fontSize: 22, fontWeight: '800', color: colors.tealDark, letterSpacing: -0.3 },
  nextRelative: { ...type.meta, color: colors.tealDark, marginTop: 2 },

  // Full-day list inside the prayer card
  dayList: { paddingHorizontal: space[4], paddingVertical: space[2] },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: space[3],
  },
  dayLabel:       { ...type.body, color: colors.ink, fontWeight: '500' },
  dayLabelActive: { color: colors.tealDark, fontWeight: '700' },
  dayLabelPast:   { color: colors.inkFaint },
  dayTime:        { ...type.body, color: colors.inkMuted, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dayTimeActive:  { color: colors.tealDark, fontWeight: '800' },
  dayTimePast:    { color: colors.inkGhost },

  calcHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[4],
    paddingBottom: space[3],
  },
  calcHintText: { ...type.micro, fontWeight: '500', color: colors.inkFaint },

  // Poll card content
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