// Inside app/(user)/index.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/useAuthStore';
import { prayersApi } from '../../api/prayers';
import { pollsApi } from '../../api/polls';

// ==========================================
// PRAYER NAMES LIST (Vertical Order Spec)
// ==========================================
const PRAYER_KEYS = [
  { key: 'tahajjud', label: 'Tahajjud' },
  { key: 'imsak',    label: 'Imsak'    },
  { key: 'fajr',     label: 'Fajr'     },
  { key: 'sunrise',  label: 'Sunrise'  },
  { key: 'dhuhr',    label: 'Dhuhr'    },
  { key: 'asr',      label: 'Asr'      },
  { key: 'iftar',    label: 'Iftar'    },
  { key: 'maghrib',  label: 'Maghrib'  },
  { key: 'isha',     label: 'Isha'     },
  { key: 'juma',     label: 'Juma'     },
];

// Backend phase constants (must match pollPhase.js PHASES)
const PHASE = {
  VOTING:       'voting',
  SPECIAL_CASE: 'special_case',
  ALLOTMENT:    'allotment',
  STATUS:       'status',
  CLOSED:       'closed',
};

export default function HomeScreen() {
  const router  = useRouter();
  const user    = useAuthStore((state) => state.user);
  const logout  = useAuthStore((state) => state.logout);
  const available_roles = useAuthStore((state) => state.available_roles);
  const switchRole      = useAuthStore((state) => state.switchRole);

  // Prayer states
  const [namazTimings,   setNamazTimings]   = useState(null);
  const [hijriDate,      setHijriDate]      = useState(null);
  const [loadingTimings, setLoadingTimings] = useState(true);

  // Poll states — driven by backend response
  const [poll,            setPoll]            = useState(null);   // poll record
  const [phase,           setPhase]           = useState(PHASE.CLOSED);
  const [myResponse,      setMyResponse]      = useState(null);   // backend my_response object
  const [loadingPoll,     setLoadingPoll]     = useState(true);
  const [submittingVote,  setSubmittingVote]  = useState(false);

  // ==========================================
  // SECTION A: FETCH NAMAZ TIMINGS
  // ==========================================
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const fetchPrayerTimes = async () => {
        try {
          setLoadingTimings(true);
          const result = await prayersApi.getToday();
          if (isMounted && result.success) {
            const { timings, tahajjud_time, imsak_time, date_hijri } = result.data;
            setHijriDate(date_hijri);
            setNamazTimings({
              tahajjud: tahajjud_time,
              imsak:    imsak_time,
              fajr:     timings?.Fajr,
              sunrise:  timings?.Sunrise,
              dhuhr:    timings?.Dhuhr,
              asr:      timings?.Asr,
              iftar:    timings?.Maghrib,  // Iftar = Maghrib time
              maghrib:  timings?.Maghrib,
              isha:     timings?.Isha,
              juma:     null,              // Not in API — Juma is weekly
            });
          }
        } catch (error) {
          console.error('Error fetching prayer timings:', error);
          if (isMounted) setNamazTimings(null);
        } finally {
          if (isMounted) setLoadingTimings(false);
        }
      };

      fetchPrayerTimes();
      return () => { isMounted = false; };
    }, [])
  );

  // ==========================================
  // SECTION B: FETCH ACTIVE POLL FROM BACKEND
  // Phase and vote status come from the server — no client-side time math.
  // ==========================================
  const fetchActivePoll = useCallback(async () => {
    try {
      setLoadingPoll(true);
      const result = await pollsApi.getActive();
      if (result.success) {
        setPoll(result.data.poll);
        setPhase(result.data.phase);
        setMyResponse(result.data.my_response);
      }
    } catch (error) {
      console.error('Error fetching poll:', error);
    } finally {
      setLoadingPoll(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchActivePoll();
      // Refresh every 5 minutes while screen is focused
      const interval = setInterval(fetchActivePoll, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }, [fetchActivePoll])
  );

  // ==========================================
  // SECTION C: SCHEDULING LOCAL NOTIFICATIONS
  // Skipped in Expo Go (SDK 53+) — works in dev/production builds only
  // ==========================================
  useEffect(() => {
    const setupDailyNotifications = async () => {
      try {
        // Lazy require so the import doesn't crash in Expo Go at module load time
        const Notifications = await import('expo-notifications');
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') return;

        await Notifications.cancelAllScheduledNotificationsAsync();

        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Sehri Poll Open 🌙',
            body: 'Will you be having Sehri food tomorrow? Cast your vote before 10 AM.',
          },
          // @ts-ignore
          trigger: { hour: 22, minute: 0, repeats: true },
        });

        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Special Case Window Open ⏰',
            body: 'Need to update your Sehri food request? Submit a special case between 10 AM - 5 PM.',
          },
          // @ts-ignore
          trigger: { hour: 10, minute: 0, repeats: true },
        });
      } catch (e) {
        // Expo Go doesn't support push notifications from SDK 53+
        // Works fine in development builds and production
        console.log('Notification setup skipped:', e.message);
      }
    };

    setupDailyNotifications();
  }, []);

  // ==========================================
  // SECTION D: POLL ACTION HANDLERS
  // ==========================================
  const handleVoteSubmit = async (voteValue) => {
    if (!poll) return;
    try {
      setSubmittingVote(true);
      await pollsApi.submitVote(poll.id, voteValue);
      // Refresh poll state from server after voting
      await fetchActivePoll();
      Alert.alert('Vote Recorded', `You voted '${voteValue}' for tomorrow's Sehri.`);
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to submit vote.';
      Alert.alert('Error', msg);
    } finally {
      setSubmittingVote(false);
    }
  };

  // Temporary role switch handler for testing
  const handleSwitchToAdmin = async () => {
    try {
      await switchRole('admin');
      router.replace('/(admin)');
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not switch role.';
      Alert.alert('Switch Failed', msg);
    }
  };

  const handleSwitchToSuperAdmin = async () => {
    try {
      await switchRole('super_admin');
      router.replace('/super-admin/superadmin-dashboard');
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not switch role.';
      Alert.alert('Switch Failed', msg);
    }
  };

  const handleSwitchToRider = async () => {
    try {
      const result = await switchRole('rider');
      if (result.isRider) {
        // Rider token saved to SecureStore — hydrate rider store then navigate
        router.push('/(rider)/map');
      }
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not switch to rider.';
      Alert.alert('Switch Failed', msg);
    }
  };

  // ==========================================
  // UI RENDER
  // ==========================================
  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.userInfo}>
          <Text style={styles.welcomeText}>Welcome,</Text>
          <Text style={styles.usernameText}>{user?.name || 'Resident'}</Text>
        </View>

        <View style={styles.headerActions}>
          {/* Temporary role switch buttons — visible only if user holds multiple roles */}
          {available_roles.includes('rider') && (
            <TouchableOpacity
              onPress={handleSwitchToRider}
              style={styles.switchRoleBtn}
            >
              <Text style={styles.switchRoleText}>Rider</Text>
            </TouchableOpacity>
          )}
          {available_roles.includes('admin') && (
            <TouchableOpacity
              onPress={handleSwitchToAdmin}
              style={styles.switchRoleBtn}
            >
              <Text style={styles.switchRoleText}>Admin</Text>
            </TouchableOpacity>
          )}
          {available_roles.includes('super_admin') && (
            <TouchableOpacity
              onPress={handleSwitchToSuperAdmin}
              style={styles.switchRoleBtn}
            >
              <Text style={styles.switchRoleText}>SA</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/profile')}
            accessibilityLabel="Open Profile"
          >
            <Ionicons name="person-circle-outline" size={38} color="#1E293B" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* NAMAZ TIMINGS CARD */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="time-outline" size={22} color="#0D9488" />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.cardTitle}>Daily Namaz Timings</Text>
              {hijriDate && <Text style={styles.hijriDate}>{hijriDate}</Text>}
            </View>
          </View>

          {loadingTimings ? (
            <ActivityIndicator size="large" color="#0D9488" style={{ marginVertical: 20 }} />
          ) : (
            <View style={styles.verticalTimingsContainer}>
              {PRAYER_KEYS.map((item, index) => {
                const timeValue = namazTimings ? (namazTimings[item.key] ?? '--:--') : '--:--';
                const isLast    = index === PRAYER_KEYS.length - 1;
                return (
                  <View
                    key={item.key}
                    style={[styles.timingRow, !isLast && styles.timingRowBorder]}
                  >
                    <Text style={styles.prayerLabel}>{item.label}</Text>
                    <Text style={styles.prayerTime}>{timeValue}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* POLL CARD */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="restaurant-outline" size={22} color="#0D9488" />
            <Text style={styles.cardTitle}>Daily Sehri Food Poll</Text>
          </View>

          {loadingPoll ? (
            <ActivityIndicator size="large" color="#0D9488" style={{ marginVertical: 20 }} />
          ) : (
            <>
              {/* VOTING phase */}
              {phase === PHASE.VOTING && (
                <View style={styles.pollSection}>
                  <Text style={styles.pollQuestion}>Will you be having Sehri food tomorrow?</Text>
                  <Text style={styles.windowInfoText}>Voting ends at 10:00 AM</Text>

                  {myResponse ? (
                    // Already voted — show their response, locked
                    <View style={styles.alreadyVotedContainer}>
                      <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
                      <Text style={styles.alreadyVotedText}>
                        You voted: <Text style={styles.votedValue}>{myResponse.response?.toUpperCase()}</Text>
                      </Text>
                    </View>
                  ) : (
                    // Not voted yet — show buttons
                    <View style={styles.voteButtonRow}>
                      <TouchableOpacity
                        style={[styles.voteButton, styles.yesButton]}
                        onPress={() => handleVoteSubmit('yes')}
                        disabled={submittingVote}
                      >
                        {submittingVote ? (
                          <ActivityIndicator color="#FFF" />
                        ) : (
                          <Text style={styles.voteButtonText}>Yes</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.voteButton, styles.noButton]}
                        onPress={() => handleVoteSubmit('no')}
                        disabled={submittingVote}
                      >
                        {submittingVote ? (
                          <ActivityIndicator color="#FFF" />
                        ) : (
                          <Text style={styles.voteButtonText}>No</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              {/* SPECIAL CASE phase */}
              {phase === PHASE.SPECIAL_CASE && (
                <View style={styles.pollSection}>
                  <Text style={styles.pollQuestion}>Changed your mind regarding Sehri food?</Text>
                  <Text style={styles.windowInfoText}>
                    Special Case Window: 10:00 AM – 5:00 PM
                  </Text>

                  {myResponse?.is_special_case ? (
                    <View style={styles.statusBox}>
                      <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
                      <Text style={styles.statusBoxText}>Special case submitted — awaiting admin review.</Text>
                    </View>
                  ) : (
                    <View style={styles.statusBox}>
                      <Ionicons name="information-circle-outline" size={20} color="#0369A1" />
                      <Text style={[styles.statusBoxText, { color: '#0369A1' }]}>
                        Special case window open. Contact your zone admin if your plans changed.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* ALLOTMENT phase */}
              {phase === PHASE.ALLOTMENT && (
                <View style={styles.closedPollContainer}>
                  <Ionicons name="hourglass-outline" size={24} color="#D97706" />
                  <Text style={styles.closedPollTitle}>Allotment in Progress</Text>
                  <Text style={styles.closedPollDescription}>
                    Super admin is reviewing special cases (5:00 PM – 6:00 PM).
                  </Text>
                  {myResponse?.sehri_allowed && (
                    <View style={[styles.statusBox, { marginTop: 12 }]}>
                      <Ionicons
                        name={myResponse.sehri_allowed === 'approved' ? 'checkmark-circle' : 'close-circle'}
                        size={20}
                        color={myResponse.sehri_allowed === 'approved' ? '#16A34A' : '#DC2626'}
                      />
                      <Text style={styles.statusBoxText}>
                        Special case {myResponse.sehri_allowed}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* STATUS phase */}
              {phase === PHASE.STATUS && (
                <View style={styles.closedPollContainer}>
                  <Ionicons name="checkmark-done-circle-outline" size={24} color="#0D9488" />
                  <Text style={styles.closedPollTitle}>Final List Confirmed</Text>
                  <Text style={styles.closedPollDescription}>
                    Results are final. Sehri delivery will begin shortly.
                  </Text>
                  {myResponse && (
                    <View style={[styles.currentVoteBadge, { marginTop: 12 }]}>
                      <Text style={styles.currentVoteText}>
                        Your vote: {myResponse.response?.toUpperCase()}
                        {myResponse.sehri_allowed
                          ? ` · Special case: ${myResponse.sehri_allowed}`
                          : ''}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* CLOSED phase */}
              {phase === PHASE.CLOSED && (
                <View style={styles.closedPollContainer}>
                  <Ionicons name="lock-closed-outline" size={24} color="#64748B" />
                  <Text style={styles.closedPollTitle}>Poll Currently Closed</Text>
                  <Text style={styles.closedPollDescription}>
                    {'• Regular Voting: 10:00 PM – 10:00 AM\n• Special Cases: 10:00 AM – 5:00 PM'}
                  </Text>
                  {myResponse && (
                    <Text style={styles.recordedVoteText}>
                      Your registered vote: {myResponse.response?.toUpperCase()}
                    </Text>
                  )}
                </View>
              )}
            </>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ==========================================
// STYLESHEET — unchanged from original
// ==========================================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  userInfo:    { flexDirection: 'column' },
  welcomeText: { fontSize: 13, color: '#64748B' },
  usernameText: { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  profileButton: { padding: 2 },
  switchRoleBtn: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 4,
  },
  switchRoleText: { fontSize: 11, fontWeight: '700', color: '#0369A1' },
  scrollContent: { padding: 16, paddingBottom: 30 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  cardTitle:  { fontSize: 16, fontWeight: '600', color: '#1E293B', marginLeft: 8 },
  hijriDate:  { fontSize: 12, color: '#0D9488', marginTop: 2, marginLeft: 8 },
  verticalTimingsContainer: { flexDirection: 'column' },
  timingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  timingRowBorder:  { borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  prayerLabel:      { fontSize: 15, fontWeight: '500', color: '#334155' },
  prayerTime:       { fontSize: 15, fontWeight: '700', color: '#0D9488' },
  pollSection:      { alignItems: 'center' },
  pollQuestion:     { fontSize: 15, fontWeight: '600', color: '#1E293B', textAlign: 'center', marginBottom: 4 },
  windowInfoText:   { fontSize: 12, color: '#64748B', marginBottom: 14, textAlign: 'center' },
  currentVoteBadge: { backgroundColor: '#E0F2FE', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginBottom: 12 },
  currentVoteText:  { fontSize: 12, fontWeight: '600', color: '#0369A1' },
  alreadyVotedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    padding: 12,
    borderRadius: 8,
    gap: 8,
    marginTop: 8,
  },
  alreadyVotedText: { fontSize: 14, color: '#15803D', fontWeight: '500' },
  votedValue:       { fontWeight: '700' },
  voteButtonRow:    { flexDirection: 'row', justifyContent: 'space-between', width: '100%', gap: 12 },
  voteButton:       { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  yesButton:        { backgroundColor: '#16A34A' },
  noButton:         { backgroundColor: '#DC2626' },
  voteButtonText:   { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  specialButton: {
    backgroundColor: '#0284C7',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    marginTop: 8,
  },
  specialButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    padding: 12,
    borderRadius: 8,
    gap: 8,
    marginTop: 8,
  },
  statusBoxText:    { fontSize: 13, color: '#15803D', fontWeight: '500', flex: 1 },
  closedPollContainer: { alignItems: 'center', paddingVertical: 12 },
  closedPollTitle:     { fontSize: 15, fontWeight: '600', color: '#475569', marginTop: 6 },
  closedPollDescription: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  recordedVoteText: { fontSize: 13, fontWeight: '600', color: '#0D9488', marginTop: 10 },
});
