// @ts-nocheck
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/useAuthStore';
import { prayersApi } from '../../api/prayers';
import { pollsApi } from '../../api/polls';
import PrayerWidget from '../../components/prayer/PrayerWidget';
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
 * NAMING — this is a Bangalore community app whose vocabulary is Urdu-
 * inflected throughout (Sehri, Dua, Imsak, Tahajjud), so the namaz names
 * follow South Asian usage rather than Gulf transliteration:
 *   • "namaz", not "prayer"
 *   • "Zuhr" (ظہر), not "Dhuhr" — Dhuhr is the Arabic-transliterated form
 *     used in Gulf/Western apps; Indian Muslims say Zuhr.
 * The Arabic script is shown alongside because Amiri is already loaded
 * app-wide (see app/_layout.tsx) for the Qur'an and Dua screens.
 *
 * NOTE: `t.Dhuhr` etc. elsewhere in this file are AlAdhan API FIELD names
 * coming off the backend — those are wire format and must not be renamed.
 */
/**
 * The roles a signed-in person can hold, and how each is presented in
 * the switcher. Keyed by the role string the backend issues.
 *
 * `user` is included so the sheet can show which role you're currently
 * in, and so someone who switched INTO this screen from an admin role
 * still sees "Member" marked as active.
 */
const ROLE_META = {
  user:        { label: 'Member',      icon: 'person-outline',           blurb: 'Vote, track delivery, and chat' },
  rider:       { label: 'Rider',       icon: 'bicycle-outline',          blurb: "Today's delivery route and stops" },
  admin:       { label: 'Zone admin',  icon: 'shield-outline',           blurb: 'Approve members and see your zone' },
  super_admin: { label: 'Super admin', icon: 'key-outline',              blurb: 'Full community administration' },
};

// Gregorian date line for the hero. All namaz-time logic now lives in
// components/prayer/prayerTimes.js and is consumed by PrayerWidget.
const gregorianLine = () =>
  new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' });

// =========================================================================
// Screen
// =========================================================================
export default function HomeScreen() {
  const router          = useRouter();
  const user            = useAuthStore((s) => s.user);
  const isGuest         = useAuthStore((s) => s.isGuest);
  const available_roles = useAuthStore((s) => s.available_roles);
  const active_role     = useAuthStore((s) => s.active_role);
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
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const [switchingRole, setSwitchingRole] = useState(null);

  // Roles this person can switch INTO (everything they hold except the
  // one they're already using). Drives whether the header button renders
  // at all — a plain member has nothing to switch to and sees nothing.
  //
  // Falls back to 'user' when active_role is unset: this IS the member
  // home screen, so that's what you're in. Without the fallback a null
  // role would leave 'user' in the switchable list and show a button
  // whose only option is the view you're already looking at.
  const switchableRoles = useMemo(() => {
    const current = active_role || 'user';
    return (available_roles || []).filter((r) => r !== current && ROLE_META[r]);
  }, [available_roles, active_role]);
  const canSwitchRole = !isGuest && switchableRoles.length > 0;

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
      setPrayerErr("Couldn't load today's namaz times.");
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
    if (switchingRole) return; // ignore double-taps mid-switch
    setSwitchingRole(role);
    try {
      const result = await switchRole(role);
      setRoleSheetOpen(false);
      if (result.isRider) return router.push('/(rider)/map');
      if (role === 'super_admin') return router.replace('/super-admin/superadmin-dashboard');
      if (role === 'admin') return router.replace('/(admin)');
      // Switching back to 'user' keeps us on this screen — just close.
    } catch (err) {
      Alert.alert("Couldn't switch role", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setSwitchingRole(null);
    }
  };

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
            <View style={styles.headerActions}>
              {/* Role switcher — only rendered when this person actually
                  holds another role, so an ordinary member never sees it.
                  Sits beside the avatar rather than in a band under the
                  hero: it's an account-level action, same family as the
                  profile button, and it no longer costs a row of vertical
                  space on the busiest screen in the app. */}
              {canSwitchRole && (
                <Pressable
                  onPress={() => setRoleSheetOpen(true)}
                  style={({ pressed }) => [styles.switchBtn, pressed && styles.switchBtnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch role. You are signed in as ${ROLE_META[active_role]?.label || 'member'}.`}
                >
                  <Ionicons name="swap-horizontal" size={19} color={colors.tealDark} />
                </Pressable>
              )}
              <Avatar
                name={user?.name}
                size={38}
                onPress={() => router.push('/profile')}
                accessibilityLabel="Open profile"
              />
            </View>
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

        {/* -------------------- Prayer timeline card -------------------- */}
        <View style={styles.section}>
          <PrayerWidget
            data={prayerData}
            loading={loadingPrayer}
            error={prayerError}
            onRetry={loadPrayer}
          />
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

      <RoleSwitchSheet
        visible={roleSheetOpen}
        onClose={() => setRoleSheetOpen(false)}
        activeRole={active_role}
        roles={switchableRoles}
        switching={switchingRole}
        onPick={handleSwitch}
      />
    </SafeAreaView>
  );
}

// -------------------------------------------------------------------------
// RoleSwitchSheet — pick which hat you're wearing.
//
// A bottom sheet rather than inline chips: the number of roles varies
// per person (1–3), a sheet scales to any of them without reflowing the
// header, and it matches the pattern this app already uses everywhere
// else for "choose one of these" (profile pickers, PG actions, voter
// drill-downs).
// -------------------------------------------------------------------------
function RoleSwitchSheet({ visible, onClose, activeRole, roles, switching, onPick }) {
  const activeMeta = ROLE_META[activeRole];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => (switching ? null : onClose())}
    >
      <Pressable style={styles.roleOverlay} onPress={() => (switching ? null : onClose())}>
        <Pressable style={styles.roleSheet} onPress={() => { /* absorb */ }}>
          <View style={styles.roleHandle} />

          <View style={styles.roleHead}>
            <View style={styles.roleOrnamentRow}>
              <View style={styles.roleOrnamentRule} />
              <RubStar size={11} />
              <View style={styles.roleOrnamentRule} />
            </View>
            <Text style={styles.roleTitle}>Switch role</Text>
            {activeMeta ? (
              <Text style={styles.roleSubtitle}>
                You&apos;re currently in <Text style={styles.roleSubtitleStrong}>{activeMeta.label}</Text> view
              </Text>
            ) : null}
          </View>

          {roles.map((role) => {
            const meta = ROLE_META[role];
            const busy = switching === role;
            return (
              <Pressable
                key={role}
                onPress={() => onPick(role)}
                disabled={!!switching}
                style={({ pressed }) => [
                  styles.roleOption,
                  pressed && !switching && styles.roleOptionPressed,
                  !!switching && !busy && styles.roleOptionMuted,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${meta.label}. ${meta.blurb}.`}
              >
                <View style={styles.roleOptionIcon}>
                  <Ionicons name={meta.icon} size={19} color={colors.tealDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.roleOptionLabel}>{meta.label}</Text>
                  <Text style={styles.roleOptionBlurb}>{meta.blurb}</Text>
                </View>
                {busy ? (
                  <ActivityIndicator size="small" color={colors.teal} />
                ) : (
                  <Ionicons name="chevron-forward" size={17} color={colors.inkGhost} />
                )}
              </Pressable>
            );
          })}

          <Button
            label="Cancel"
            variant="secondary"
            onPress={onClose}
            disabled={!!switching}
            fullWidth
            style={{ marginTop: space[3] }}
          />
        </Pressable>
      </Pressable>
    </Modal>
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
      <Text style={styles.inviteTitle}>Join today&apos;s Sehri poll</Text>
      <Text style={styles.inviteBody}>
        Sign in to tell your zone whether you&apos;ll be having Sehri tomorrow —
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
        <Text style={styles.pollHeadline}>You didn&apos;t vote today.</Text>
        <Text style={styles.pollBody}>
          Only users who voted can raise a special case. Voting reopens at 10 pm for tomorrow&apos;s Sehri.
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
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { paddingBottom: space[8] },

  // Wordmark
  wordmarkRow: { flexDirection: 'row', alignItems: 'center' },
  wordmarkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal, marginRight: space[2] },
  wordmark:    { fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },

  // ---- Header actions (role switch + avatar) ---------------------------
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  switchBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  switchBtnPressed: { backgroundColor: colors.tealBorder },

  // ---- Role switch sheet ------------------------------------------------
  roleOverlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  roleSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[5],
    paddingTop: space[3],
    paddingBottom: space[5],
  },
  roleHandle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[3],
  },
  roleHead: { alignItems: 'center', marginBottom: space[4] },
  roleOrnamentRow: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    width: 130, marginBottom: space[1],
  },
  roleOrnamentRule: { flex: 1, height: 1, backgroundColor: colors.goldBorder, opacity: 0.6 },
  roleTitle:    { ...type.h2, color: colors.ink },
  roleSubtitle: { ...type.meta, color: colors.inkMuted, marginTop: 3 },
  roleSubtitleStrong: { fontWeight: '800', color: colors.tealDark },

  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    marginBottom: space[2],
  },
  roleOptionPressed: { backgroundColor: colors.tealSoft, borderColor: colors.tealBorder },
  roleOptionMuted:   { opacity: 0.45 },
  roleOptionIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.tealSoft,
    borderWidth: 1, borderColor: colors.tealBorder,
  },
  roleOptionLabel: { ...type.bodyStrong, color: colors.ink },
  roleOptionBlurb: { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  // Section wrapper
  section:    { paddingHorizontal: space[4], paddingTop: space[4] },

  // ---- Prayer HERO ------------------------------------------------------
  // Urgent = under 5 minutes of the window left. Warm amber wash rather
  // than red: the window closing is a nudge, not an error.

  // Segmented running counter

  // Window progress bar

  // ---- Ornament divider between hero + ribbon --------------------------

  // ---- Horizontal ribbon timeline --------------------------------------
  // Rail: two halves so past/future can be tinted independently

  // Dot styles
  // "Up next" — hollow gold ring. Used during the post-sunrise gap.
  // "Currently running" — filled teal with a gold ring. Deliberately the
  // heaviest marker on the ribbon: it's the answer to the question the
  // user opened this screen to ask.

  // Node text

  // Fallback hint

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
