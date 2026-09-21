import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pollsApi } from '../../api/polls';
import { adminApi } from '../../api/admin';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Super admin — polls management screen.
//
//   Tab 1: Today — live phase + manual voting override toggle
//   Tab 2: All polls — paginated history
//   Tab 3: By date — zone-by-zone breakdown lookup
//
// The manual override toggles poll.is_active on the backend
// (PATCH /api/polls/active/toggle). Because is_active overrides the
// scheduled 10 PM–10 AM voting window, the Today tab surfaces the
// override state explicitly so the super admin never wonders "why is
// the state not matching the clock?".
// -----------------------------------------------------------------------------

const ZONE_LABELS = {
  masjid:      'Masjid',
  boys_hostel: "Boys' hostel",
  stanza:      'Stanza',
  girls:       'Girls',
};

const PHASE_LABELS = {
  voting:       { label: 'Voting open',           tone: 'teal',    icon: 'checkmark-circle-outline' },
  special_case: { label: 'Special case window',   tone: 'warn',    icon: 'alert-circle-outline' },
  allotment:    { label: 'Allotment window',      tone: 'gold',    icon: 'hourglass-outline' },
  status:       { label: 'Final list',            tone: 'success', icon: 'ribbon-outline' },
  closed:       { label: 'Voting closed',         tone: 'neutral', icon: 'lock-closed-outline' },
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * Read the current IST hour (0–23) using Intl.DateTimeFormat.formatToParts —
 * device-timezone-safe, matches the backend pattern in utils/pollPhase.js.
 * Plain toLocaleString with hour12:false returns "24" at midnight on some
 * V8 versions — we `% 24` defensively.
 */
const readISTHour = () => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === 'hour');
    return h ? parseInt(h.value, 10) % 24 : 0;
  } catch { return 0; }
};

/** Voting window is 22:00–23:59 and 00:00–09:59 IST. */
const inScheduledVotingWindow = () => {
  const h = readISTHour();
  return h >= 22 || h < 10;
};

export default function SuperAdminPolls() {
  const router = useRouter();
  const [tab, setTab] = useState('today');

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Polls" onBack={() => router.back()} />

      <View style={styles.tabRow}>
        <TabButton active={tab === 'today'}   label="Today"     onPress={() => setTab('today')} />
        <TabButton active={tab === 'history'} label="All polls" onPress={() => setTab('history')} />
        <TabButton active={tab === 'date'}    label="By date"   onPress={() => setTab('date')} />
      </View>

      {tab === 'today'   && <TodayTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'date'    && <DateStatsTab />}
    </SafeAreaView>
  );
}

function TabButton({ active, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

// -----------------------------------------------------------------------------
// Tab 1: Today — live phase, override state, manual toggle
// -----------------------------------------------------------------------------
function TodayTab() {
  const [data, setData]         = useState(null);   // { poll, phase, my_response }
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [toggling, setToggling] = useState(false);
  const [confirming, setConfirming] = useState(false); // two-step gate
  const [creating, setCreating] = useState(false);   // manual create-today spinner
  const [stats, setStats] = useState(null);          // { by_zone, grand_total, my_zone }
  const [statsError, setStatsError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setStatsError(null);
    setConfirming(false);
    try {
      // Poll metadata + phase (blocking — decides whether the toggle
      // card and stats grid should even render).
      const res = await pollsApi.getActive();
      if (res.success) setData(res.data);

      // Live zone-by-zone vote totals for today. Same endpoint the
      // admin dashboard uses; for super_admin it returns every zone.
      // Non-blocking — if it fails we still show the phase card and
      // the toggle card, just with a "stats unavailable" note.
      try {
        const statsRes = await adminApi.getActiveStats();
        if (statsRes.success) setStats(statsRes.data);
      } catch (statsErr) {
        setStatsError(statsErr?.response?.data?.message || "Couldn't load vote totals.");
        setStats(null);
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load today's poll.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Ticker every 30 s so the stats card feels live without needing a
  // pull-to-refresh — cheap query and the phase/toggle state doesn't
  // change often enough to also poll.
  useEffect(() => {
    if (!data?.poll?.id) return undefined;
    const t = setInterval(async () => {
      try {
        const statsRes = await adminApi.getActiveStats();
        if (statsRes.success) setStats(statsRes.data);
      } catch { /* silent — next tick tries again */ }
    }, 30 * 1000);
    return () => clearInterval(t);
  }, [data?.poll?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Manual safety net — the daily cron that would normally create the
  // poll doesn't exist yet (see backend/README on the cron gap), so a
  // super admin needs a way to create it themselves. Idempotent on the
  // backend; 409 collision surfaces as a friendly alert.
  const handleCreateToday = () => {
    Alert.alert(
      "Create today's poll?",
      "This creates the day's Sehri poll immediately. Skip only if the automatic schedule has already run — you'll get a warning if a poll already exists.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: async () => {
            setCreating(true);
            try {
              const res = await pollsApi.createTodayPoll();
              if (res.success) {
                Alert.alert("Today's poll created", res.message || 'Ready for voting.');
                await load();
              }
            } catch (err) {
              const msg = err?.response?.data?.message || 'Try again in a moment.';
              Alert.alert("Couldn't create poll", msg);
              // If the backend says it already exists, reload so the UI
              // reflects reality (someone else beat us to it).
              if (err?.response?.status === 409) await load();
            } finally {
              setCreating(false);
            }
          },
        },
      ]
    );
  };

  const poll  = data?.poll  || null;
  const phase = data?.phase || 'closed';
  const cfg   = PHASE_LABELS[phase] || PHASE_LABELS.closed;

  // Override detection — see the module comment. Because the backend derives
  // phase from is_active + IST hour, we can detect override by comparing.
  const override = useMemo(() => {
    if (!poll) return null;
    const inWindow = inScheduledVotingWindow();
    // Super admin force-closed voting DURING the scheduled window.
    if (poll.is_active === false && inWindow) {
      return {
        kind:    'closed',
        message: 'Voting is manually closed. Would normally be open until 10:00 AM.',
      };
    }
    // Super admin extended voting OUTSIDE the scheduled window.
    if (poll.is_active === true && !inWindow) {
      return {
        kind:    'extended',
        message: 'Voting is manually extended. Would normally have closed at 10:00 AM.',
      };
    }
    return null;
  }, [poll]);

  // Toggle target — what happens if the super admin taps the primary button.
  // We ALWAYS write is_active = !current; the backend re-derives phase.
  const toggleTarget = poll?.is_active ? 'close' : 'reopen';

  const handleToggle = () => {
    if (!poll) return;
    if (!confirming) { setConfirming(true); return; }
    // Second tap → fire.
    (async () => {
      setToggling(true);
      try {
        const res = await pollsApi.togglePoll(!poll.is_active);
        if (res.success) {
          setData((prev) => (prev ? {
            ...prev,
            poll:  { ...prev.poll, is_active: res.data.is_active },
            phase: res.data.phase,
          } : prev));
          setConfirming(false);
          Alert.alert(
            res.data.is_active ? 'Voting reopened' : 'Voting closed',
            res.data.is_active
              ? 'Users can now vote. Special cases and allotment still run on schedule.'
              : 'Voting is closed for today. Reopen anytime.',
          );
        }
      } catch (err) {
        Alert.alert("Couldn't update poll", err?.response?.data?.message || 'Try again in a moment.');
      } finally {
        setToggling(false);
      }
    })();
  };

  if (loading) return <LoadingState message="Loading today's poll…" />;
  if (error)   return <ErrorState message={error} onRetry={load} />;

  if (!poll) {
    return (
      <ScrollView contentContainerStyle={styles.list}>
        <SectionHeader title="Today" ornament="star" />
        <Card>
          <Text style={styles.blockTitle}>No poll for today</Text>
          <Text style={styles.blockBody}>
            The daily poll is normally opened automatically at 10 pm. If that
            didn't run, you can create it manually now — voting opens
            immediately if you're inside the scheduled window (10 pm–10 am),
            otherwise the poll is created in a paused state and you can flip
            it on from here.
          </Text>
          <View style={{ marginTop: space[3] }}>
            <Button
              label={creating ? 'Creating…' : "Create today's poll"}
              onPress={handleCreateToday}
              loading={creating}
              disabled={creating}
              icon="add-circle-outline"
              fullWidth
            />
          </View>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.list}>
      {/* Phase hero */}
      <Card padding={false}>
        <View style={styles.phaseHero}>
          <View style={[styles.phaseIcon, { backgroundColor: toneBg(cfg.tone) }]}>
            <Ionicons name={cfg.icon} size={22} color={toneFg(cfg.tone)} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.phaseEyebrow}>Today's poll · {formatDate(poll.date)}</Text>
            <Text style={styles.phaseTitle}>{cfg.label}</Text>
          </View>
          <Chip label={poll.is_active ? 'Active' : 'Inactive'} tone={poll.is_active ? 'success' : 'neutral'} />
        </View>

        {/* Override banner — makes it unambiguous why phase doesn't match the clock */}
        {override && (
          <View style={styles.overrideStrip}>
            <Ionicons
              name={override.kind === 'closed' ? 'shield-outline' : 'time-outline'}
              size={16}
              color={colors.gold}
            />
            <Text style={styles.overrideText}>{override.message}</Text>
          </View>
        )}
      </Card>

      {/* Toggle card */}
      <View style={{ marginTop: space[3] }}>
        <Card>
          <Text style={styles.blockTitle}>Manual voting override</Text>
          <Text style={styles.blockBody}>
            {poll.is_active
              ? 'Voting is open. Close it early to stop new votes ahead of the 10 AM cutoff.'
              : 'Voting is closed. Reopen it if you want to extend or restart the window.'}
          </Text>

          {confirming && (
            <View style={styles.confirmStrip}>
              <Ionicons name="alert-circle" size={16} color={colors.gold} />
              <Text style={styles.confirmText}>
                {toggleTarget === 'close'
                  ? 'Tap again to close voting for every user immediately.'
                  : 'Tap again to reopen voting — users can vote right away.'}
              </Text>
            </View>
          )}

          <View style={styles.toggleActions}>
            {confirming && (
              <Button
                label="Cancel"
                onPress={() => setConfirming(false)}
                variant="secondary"
                size="sm"
                style={{ flex: 1 }}
                disabled={toggling}
              />
            )}
            <Button
              label={
                toggling
                  ? 'Working…'
                  : confirming
                    ? (toggleTarget === 'close' ? 'Confirm close' : 'Confirm reopen')
                    : (toggleTarget === 'close' ? 'Close voting now' : 'Reopen voting now')
              }
              onPress={handleToggle}
              loading={toggling}
              disabled={toggling}
              icon={toggleTarget === 'close' ? 'lock-closed-outline' : 'lock-open-outline'}
              variant={toggleTarget === 'close' ? 'secondary' : 'primary'}
              style={confirming ? { flex: 1.2 } : { alignSelf: 'flex-start', marginTop: space[3] }}
            />
          </View>
        </Card>
      </View>

      {/* Live vote totals — polls every 30 s. Kitchen-facing view: the
          grand total is what the meal count is prepped for; the per-zone
          rows tell them how many packets per zone. Uses the same
          endpoint the admin dashboard consumes, but for super_admin the
          backend returns every zone. */}
      <View style={{ marginTop: space[3] }}>
        <StatsCard stats={stats} statsError={statsError} onRetry={load} />
      </View>

      {/* Daily schedule reminder */}
      <View style={{ marginTop: space[3] }}>
        <Card tone="warm">
          <Text style={styles.blockTitle}>Daily schedule</Text>
          <ScheduleRow time="10:00 PM"         desc="Voting opens" />
          <ScheduleRow time="10:00 AM"         desc="Voting closes" />
          <ScheduleRow time="10:00 AM – 5:00 PM" desc="Special cases window" />
          <ScheduleRow time="5:00 PM – 6:00 PM"  desc="Allotment (super admin reviews)" />
          <ScheduleRow time="6:00 PM – 10:00 PM" desc="Final list visible, no changes" isLast />
        </Card>
      </View>
    </ScrollView>
  );
}

// -----------------------------------------------------------------------------
// StatsCard — live grand-total + per-zone breakdown for today's poll.
// Styled to match the admin dashboard's equivalent card exactly so
// admins and super admins see the same visual language.
// -----------------------------------------------------------------------------
function StatsCard({ stats, statsError, onRetry }) {
  if (statsError) {
    return (
      <Card>
        <Text style={styles.blockTitle}>Live vote totals</Text>
        <Text style={{ ...type.meta, color: colors.danger, marginTop: space[2] }}>
          {statsError}
        </Text>
        <View style={{ marginTop: space[2] }}>
          <Button label="Retry" onPress={onRetry} variant="secondary" size="sm" icon="refresh" />
        </View>
      </Card>
    );
  }
  if (!stats?.grand_total) {
    return (
      <Card>
        <Text style={styles.blockTitle}>Live vote totals</Text>
        <Text style={styles.blockBody}>Waiting for the first vote to come in…</Text>
      </Card>
    );
  }
  const grand = stats.grand_total;
  const byZone = stats.by_zone || {};
  return (
    <Card padding={false}>
      <View style={{ padding: space[4], paddingBottom: 0 }}>
        <Text style={styles.blockTitle}>Live vote totals</Text>
        <Text style={styles.blockBody}>Updates every 30 seconds.</Text>
      </View>
      <View style={styles.statsGrandRow}>
        <StatCell label="Yes"   value={grand.yes}   color={colors.success} />
        <View style={styles.statDivider} />
        <StatCell label="No"    value={grand.no}    color={colors.danger} />
        <View style={styles.statDivider} />
        <StatCell label="Total" value={grand.total} color={colors.tealDark} />
      </View>
      <View style={styles.statsZoneList}>
        {Object.entries(byZone).map(([zone, counts], idx, arr) => (
          <View key={zone}>
            <View style={styles.statsZoneRow}>
              <Text style={styles.zoneLabel}>{ZONE_LABELS[zone] || zone}</Text>
              <View style={styles.zoneStats}>
                <Text style={[styles.zoneVal, { color: colors.success  }]}>{counts.yes}</Text>
                <Text style={[styles.zoneVal, { color: colors.danger   }]}>{counts.no}</Text>
                <Text style={[styles.zoneVal, { color: colors.tealDark }]}>{counts.total}</Text>
              </View>
            </View>
            {idx < arr.length - 1 && <View style={styles.zoneRule} />}
          </View>
        ))}
      </View>
    </Card>
  );
}

function ScheduleRow({ time, desc, isLast }) {
  return (
    <View style={[styles.scheduleRow, !isLast && styles.scheduleRowRule]}>
      <Text style={styles.scheduleTime}>{time}</Text>
      <Text style={styles.scheduleDesc}>{desc}</Text>
    </View>
  );
}

const toneBg = (tone) => ({
  teal: colors.tealSoft, gold: colors.goldSoft, success: colors.successSoft,
  warn: colors.warnSoft, danger: colors.dangerSoft, neutral: colors.ruleFaint,
}[tone] || colors.ruleFaint);

const toneFg = (tone) => ({
  teal: colors.tealDark, gold: colors.gold, success: colors.success,
  warn: colors.warn, danger: colors.danger, neutral: colors.inkMuted,
}[tone] || colors.inkMuted);

// -----------------------------------------------------------------------------
// Tab 2: All polls (paginated)
// -----------------------------------------------------------------------------
function HistoryTab() {
  const [polls, setPolls]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const [total, setTotal]     = useState(0);
  const [error, setError]     = useState(null);
  const LIMIT = 20;

  const fetchHistory = useCallback(async (p = 1) => {
    setLoading(true);
    setError(null);
    try {
      const res = await pollsApi.getHistory(p, LIMIT);
      if (res.success) {
        setPolls(res.data.polls);
        setTotal(res.data.total);
        setPage(p);
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load past polls.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchHistory(1); }, [fetchHistory]));

  const totalPages = Math.ceil(total / LIMIT);

  if (loading) return <LoadingState message="Loading past polls…" />;
  if (error)   return <ErrorState message={error} onRetry={() => fetchHistory(1)} />;
  if (polls.length === 0) return <EmptyState icon="stats-chart-outline" title="No past polls" message="Once the daily polls run, they'll show up here." />;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={polls}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
        renderItem={({ item }) => (
          <Card>
            <View style={styles.historyHead}>
              <Text style={styles.historyDate}>{formatDate(item.date)}</Text>
              <Chip label={`${item.total_votes} votes`} tone="teal" />
            </View>
            {item.question ? <Text style={styles.historyQ} numberOfLines={2}>{item.question}</Text> : null}

            <View style={styles.miniStrip}>
              <StatCell label="Yes"   value={item.total_yes}   color={colors.success} />
              <View style={styles.statDivider} />
              <StatCell label="No"    value={item.total_no}    color={colors.danger}  />
              <View style={styles.statDivider} />
              <StatCell label="Total" value={item.total_votes} color={colors.tealDark} />
            </View>
          </Card>
        )}
      />

      {totalPages > 1 && (
        <View style={styles.pagination}>
          <Button label="Previous" onPress={() => fetchHistory(page - 1)} disabled={page <= 1}         variant="ghost"     size="sm" icon="chevron-back" />
          <Text style={styles.pageText}>Page {page} of {totalPages}</Text>
          <Button label="Next"     onPress={() => fetchHistory(page + 1)} disabled={page >= totalPages} variant="ghost"     size="sm" icon="chevron-forward" iconRight />
        </View>
      )}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Tab 3: Zone breakdown for a specific date
// -----------------------------------------------------------------------------
function DateStatsTab() {
  const [inputDate, setInputDate] = useState(todayIST());
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const fetchStats = async (date) => {
    if (!date) return;
    setLoading(true); setError(null); setData(null);
    try {
      const res = await pollsApi.getDateStats(date);
      if (res.success) setData(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || `No poll on record for ${date}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.list}>
      <SectionHeader title="Look up a date" />
      <Card>
        <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
        <Input
          value={inputDate}
          onChangeText={setInputDate}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          icon="calendar-outline"
        />
        <View style={styles.searchActions}>
          <Button label="Today" onPress={() => { const t = todayIST(); setInputDate(t); fetchStats(t); }} variant="secondary" size="sm" />
          <Button label="Look up" onPress={() => fetchStats(inputDate)} size="sm" icon="search-outline" />
        </View>
      </Card>

      {loading && <LoadingState message="Loading stats…" compact />}

      {!loading && error && (
        <View style={{ marginTop: space[4] }}>
          <Card><EmptyState icon="calendar-outline" title="No results" message={error} /></Card>
        </View>
      )}

      {!loading && data && (
        <View style={{ marginTop: space[4] }}>
          <Card padding={false}>
            <View style={styles.dateHead}>
              <Text style={styles.dateTitle}>{formatDate(data.poll.date)}</Text>
              {data.poll.question ? <Text style={styles.dateSub} numberOfLines={2}>{data.poll.question}</Text> : null}
            </View>

            <View style={styles.miniStrip}>
              <StatCell label="Yes"   value={data.grand_total.yes}   color={colors.success} />
              <View style={styles.statDivider} />
              <StatCell label="No"    value={data.grand_total.no}    color={colors.danger}  />
              <View style={styles.statDivider} />
              <StatCell label="Total" value={data.grand_total.total} color={colors.tealDark} />
            </View>

            <View style={styles.zoneWrap}>
              {Object.entries(data.by_zone).map(([zone, counts], idx, arr) => (
                <View key={zone}>
                  <View style={styles.zoneRow}>
                    <Text style={styles.zoneLabel}>{ZONE_LABELS[zone] || zone}</Text>
                    <View style={styles.zoneStats}>
                      <Text style={[styles.zoneVal, { color: colors.success }]}>{counts.yes}</Text>
                      <Text style={[styles.zoneVal, { color: colors.danger  }]}>{counts.no}</Text>
                      <Text style={[styles.zoneVal, { color: colors.tealDark }]}>{counts.total}</Text>
                    </View>
                  </View>
                  {idx < arr.length - 1 && <View style={styles.zoneRule} />}
                </View>
              ))}
            </View>
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

function StatCell({ label, value, color }) {
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    paddingHorizontal: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
  },
  tab:            { flex: 1, paddingVertical: space[3], alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:      { borderBottomColor: colors.teal },
  tabLabel:       { ...type.body, fontWeight: '600', color: colors.inkFaint },
  tabLabelActive: { color: colors.teal, fontWeight: '700' },

  list: { padding: space[4], paddingBottom: space[8] },

  // Today tab
  phaseHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
  },
  phaseIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  phaseEyebrow: { ...type.micro, color: colors.inkFaint, marginBottom: 2 },
  phaseTitle:   { ...type.h2 },

  overrideStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.goldSoft,
    borderTopWidth: 1,
    borderTopColor: colors.goldBorder,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  overrideText: { ...type.meta, flex: 1, color: colors.ink },

  blockTitle: { ...type.h3 },
  blockBody:  { ...type.body, marginTop: space[1] },

  confirmStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.goldSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    padding: space[3],
    marginTop: space[3],
  },
  confirmText: { ...type.meta, color: colors.ink, flex: 1 },

  toggleActions: { flexDirection: 'row', gap: space[2] },

  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: space[2],
  },
  scheduleRowRule: {
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleFaint,
  },
  scheduleTime: {
    ...type.metaStrong,
    color: colors.gold,
    width: 140,
    fontVariant: ['tabular-nums'],
  },
  scheduleDesc: { ...type.meta, flex: 1 },

  // History + date tabs
  historyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space[2] },
  historyDate: { ...type.h3, color: colors.tealDark },
  historyQ:    { ...type.meta, marginBottom: space[3] },

  miniStrip:  { flexDirection: 'row', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  statCell:   { flex: 1, alignItems: 'center' },
  statDivider:{ width: 1, backgroundColor: colors.ruleSoft },
  statValue:  { fontSize: 20, fontWeight: '800' },
  statLabel:  { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  label:         { ...type.meta, color: colors.inkMuted, marginBottom: space[2], fontWeight: '600' },
  searchActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], marginTop: space[3] },

  dateHead:  { padding: space[4] },
  dateTitle: { ...type.h3 },
  dateSub:   { ...type.meta, marginTop: 2 },

  zoneWrap:  {},
  zoneRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space[4], paddingVertical: space[3] },
  zoneRule:  { height: 1, backgroundColor: colors.ruleFaint, marginHorizontal: space[4] },
  zoneLabel: { ...type.body, fontWeight: '600' },
  zoneStats: { flexDirection: 'row', gap: space[4] },
  zoneVal:   { fontSize: 14, fontWeight: '700', minWidth: 32, textAlign: 'right' },

  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
    backgroundColor: colors.paper,
  },
  pageText: { ...type.meta, fontWeight: '600', color: colors.inkMuted },

  // Live stats card (Today tab)
  statsGrandRow: {
    flexDirection: 'row',
    paddingVertical: space[3],
    marginTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
  },
  statsZoneList: { borderTopWidth: 1, borderTopColor: colors.ruleSoft },
  statsZoneRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
});
