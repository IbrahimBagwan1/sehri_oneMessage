import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { usersApi } from '../../api/users';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

const STATUS = {
  pending:  { label: 'Pending',  tone: 'warn'    },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger'  },
};

const FIELD_LABELS = {
  name:        'Name',
  gender:      'Gender',
  occupation:  'Occupation',
  city:        'City',
  location_id: 'Location',
  address:     'Address',
};

const FILTERS = [
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all',      label: 'All'      },
];

const resolveZoneName = (location) => {
  let cur = location; let hops = 0;
  while (cur && cur.type !== 'zone' && hops < 10) { cur = cur.parent || null; hops += 1; }
  return cur?.type === 'zone' ? cur.name : null;
};

const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function SuperAdminRequests() {
  const router = useRouter();
  const [filter,     setFilter]     = useState('pending');
  const [requests,   setRequests]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState(null);
  const [busyId,     setBusyId]     = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await usersApi.getProfileEditRequests({ status: filter === 'all' ? undefined : filter });
      if (res.success) setRequests(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDecision = (id, decision, name) => {
    const verb = decision === 'approved' ? 'approve' : 'reject';
    Alert.alert(
      `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${name}'s changes?`,
      decision === 'approved'
        ? 'The changes will apply to their profile immediately.'
        : 'The user will need to submit a new request if they still want to change these details.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb.charAt(0).toUpperCase() + verb.slice(1),
          style: decision === 'rejected' ? 'destructive' : 'default',
          onPress: async () => {
            setBusyId(id);
            try {
              await usersApi.reviewProfileEditRequest(id, decision);
              setRequests((prev) =>
                filter === 'all'
                  ? prev.map((r) => r.id === id ? { ...r, status: decision } : r)
                  : prev.filter((r) => r.id !== id)
              );
            } catch (err) {
              Alert.alert("Couldn't save", err?.response?.data?.message || 'Try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header title="Profile requests" onBack={() => router.back()} />

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            tone={filter === f.key ? 'teal' : 'neutral'}
            selected={filter === f.key}
            onPress={() => setFilter(f.key)}
          />
        ))}
      </View>

      {loading ? (
        <LoadingState message="Loading requests…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />}
        >
          {requests.length === 0 ? (
            <EmptyState
              icon="checkbox-outline"
              title={filter === 'pending' ? 'Nothing to review' : `No ${filter} requests`}
              message={filter === 'pending' ? "Everyone's up-to-date." : 'Nothing matches this filter.'}
            />
          ) : (
            requests.map((r) => {
              const cfg    = STATUS[r.status] || STATUS.pending;
              const zone   = resolveZoneName(r.user?.location);
              const isBusy = busyId === r.id;
              const changes = r.requested_changes || {};
              const isPending = r.status === 'pending';
              return (
                <View key={r.id} style={{ marginBottom: space[2] }}>
                  <Card>
                    <View style={styles.head}>
                      <Avatar name={r.user?.name} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.userName}>{r.user?.name || 'Unknown'}</Text>
                        <Text style={styles.userMeta}>
                          {r.user?.phone || ''}{zone ? ` · ${zone}` : ''}
                        </Text>
                      </View>
                      <Chip label={cfg.label} tone={cfg.tone} />
                    </View>

                    <View style={styles.changes}>
                      <Text style={styles.changesTitle}>Requested changes</Text>
                      {Object.entries(changes).length === 0 ? (
                        <Text style={styles.changeVal}>—</Text>
                      ) : (
                        Object.entries(changes).map(([field, value]) => (
                          <View key={field} style={styles.changeRow}>
                            <Text style={styles.changeKey}>{FIELD_LABELS[field] || field}</Text>
                            <Text style={styles.changeVal} numberOfLines={2}>{String(value)}</Text>
                          </View>
                        ))
                      )}
                    </View>

                    <Text style={styles.date}>Submitted {formatWhen(r.created_at)}</Text>

                    {isPending && (
                      <View style={styles.actions}>
                        <Button label="Reject"  onPress={() => handleDecision(r.id, 'rejected', r.user?.name || 'user')} loading={isBusy} variant="secondary" size="sm" icon="close"     style={{ flex: 1 }} />
                        <Button label="Approve" onPress={() => handleDecision(r.id, 'approved', r.user?.name || 'user')} loading={isBusy} size="sm" icon="checkmark" style={{ flex: 1 }} />
                      </View>
                    )}
                  </Card>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  filterRow: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3] },
  scroll:    { padding: space[4], paddingBottom: space[8] },

  head:     { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[3] },
  userName: { ...type.h3 },
  userMeta: { ...type.meta, marginTop: 2 },

  changes: {
    backgroundColor: colors.paperSoft,
    borderRadius: radius.md,
    padding: space[3],
    marginBottom: space[2],
  },
  changesTitle: { ...type.metaStrong, color: colors.inkMuted, marginBottom: space[2] },
  changeRow:    { flexDirection: 'row', marginBottom: space[1] },
  changeKey:    { ...type.meta, fontWeight: '600', width: 100 },
  changeVal:    { flex: 1, ...type.body },

  date: { ...type.micro, color: colors.inkGhost, marginBottom: space[3] },

  actions: {
    flexDirection: 'row',
    gap: space[2],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
});
