import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { donationsApi } from '../api/donations';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
} from '../components/ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// DonationHistoryScreen — user's own donation history.
//
// A "verified" donation gets a subtle warm-parchment card so a good
// outcome reads differently from a pending or rejected one, without
// resorting to loud generic red/green banners.
// -----------------------------------------------------------------------------

const STATUS = {
  pending:  { label: 'Awaiting review', tone: 'warn'    },
  verified: { label: 'Verified',        tone: 'success' },
  rejected: { label: 'Rejected',        tone: 'danger'  },
};

const FILTERS = [
  { key: 'all',      label: 'All'       },
  { key: 'pending',  label: 'Pending'   },
  { key: 'verified', label: 'Verified'  },
  { key: 'rejected', label: 'Rejected'  },
];

const formatINR = (n) => {
  const v = Number.parseFloat(n);
  if (!Number.isFinite(v)) return '₹0';
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function DonationHistoryScreen() {
  const router = useRouter();
  const [filter,      setFilter]      = useState('all');
  const [donations,   setDonations]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState(null);
  const [previewUri,  setPreviewUri]  = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await donationsApi.getMy({
        page: 1,
        limit: 100,
        status: filter === 'all' ? undefined : filter,
      });
      if (res.success) setDonations(res.data.donations || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load your donations right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totalVerified = useMemo(
    () => donations
      .filter((d) => d.status === 'verified')
      .reduce((sum, d) => sum + Number.parseFloat(d.amount || 0), 0),
    [donations]
  );

  const renderItem = ({ item }) => {
    const cfg = STATUS[item.status] || STATUS.pending;
    const isVerified = item.status === 'verified';

    return (
      <Card tone={isVerified ? 'warm' : 'paper'}>
        <View style={styles.headRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.amount}>{formatINR(item.amount)}</Text>
            <Text style={styles.when}>{formatWhen(item.created_at)}</Text>
          </View>
          <Chip label={cfg.label} tone={cfg.tone} />
        </View>

        {item.note ? <Text style={styles.note}>{item.note}</Text> : null}

        {item.status === 'rejected' && item.rejection_reason ? (
          <View style={styles.rejectBox}>
            <Ionicons name="information-circle-outline" size={14} color={colors.danger} />
            <Text style={styles.rejectText}>{item.rejection_reason}</Text>
          </View>
        ) : null}

        {item.screenshot_url ? (
          <Pressable
            onPress={() => setPreviewUri(item.screenshot_url)}
            style={({ pressed }) => [styles.thumbRow, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="View payment screenshot"
          >
            <Image source={{ uri: item.screenshot_url }} style={styles.thumb} />
            <View style={{ flex: 1 }}>
              <Text style={styles.thumbLabel}>Payment screenshot</Text>
              <Text style={styles.thumbHint}>Tap to view full-size</Text>
            </View>
            <Ionicons name="expand-outline" size={16} color={colors.inkFaint} />
          </Pressable>
        ) : null}
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="My donations" onBack={() => router.back()} />

      {/* Total */}
      <View style={styles.totalWrap}>
        <View style={styles.totalCard}>
          <View>
            <Text style={styles.totalEyebrow}>Total contributed</Text>
            <Text style={styles.totalAmount}>{formatINR(totalVerified)}</Text>
            <Text style={styles.totalHint}>Verified donations only</Text>
          </View>
          <View style={styles.totalIcon}>
            <Ionicons name="heart" size={22} color={colors.gold} />
          </View>
        </View>
      </View>

      {/* Filter chips */}
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
        <LoadingState message="Loading your donations…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : (
        <FlatList
          data={donations}
          keyExtractor={(d) => d.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[colors.teal]}
              tintColor={colors.teal}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="wallet-outline"
              title={filter === 'all' ? 'No donations yet' : `No ${filter} donations`}
              message={
                filter === 'all'
                  ? 'When you submit a donation, it will show up here so you can watch its verification status.'
                  : 'Nothing matches this filter right now.'
              }
              actionLabel={filter === 'all' ? 'Donate now' : undefined}
              onAction={filter === 'all' ? () => router.replace('/(user)/donate') : undefined}
            />
          }
        />
      )}

      {/* Full-size screenshot preview modal */}
      <Modal
        visible={!!previewUri}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUri(null)}
      >
        <View style={styles.previewOverlay}>
          <Pressable
            onPress={() => setPreviewUri(null)}
            style={styles.previewClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
          >
            <Ionicons name="close" size={24} color={colors.paper} />
          </Pressable>
          {previewUri ? (
            <Image
              source={{ uri: previewUri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const WINDOW = Dimensions.get('window');

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  totalWrap: { padding: space[4], paddingBottom: 0 },
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space[4],
  },
  totalEyebrow: { ...type.micro, color: colors.gold, fontWeight: '700', marginBottom: space[1] },
  totalAmount:  { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  totalHint:    { ...type.micro, color: colors.inkFaint, marginTop: 2 },
  totalIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.paper,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.goldBorder,
  },

  filterRow: {
    flexDirection: 'row',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    flexWrap: 'wrap',
  },

  list: { padding: space[4], paddingBottom: space[8] },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  amount:  { fontSize: 20, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  when:    { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  note: { ...type.body, color: colors.inkMuted, marginTop: space[2] },

  rejectBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: space[3],
    marginTop: space[3],
  },
  rejectText: { flex: 1, ...type.meta, color: colors.danger },

  thumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
  thumb: {
    width: 40, height: 52,
    borderRadius: radius.sm,
    backgroundColor: colors.ruleFaint,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
  },
  thumbLabel: { ...type.metaStrong },
  thumbHint:  { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    zIndex: 10,
  },
  previewImage: {
    width:  WINDOW.width,
    height: WINDOW.height * 0.85,
  },
});
