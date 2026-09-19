import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  Modal,
  Pressable,
  Alert,
  RefreshControl,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { donationsApi } from '../../api/donations';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// AdminDonationsScreen — super-admin verification.
//
// Hero at top: total verified amount, with a pending-count sub-line
// so the reviewer sees at a glance how much is waiting for them.
// List: filterable by status; tap the screenshot thumbnail to open
// full-size; approve or reject inline.
// -----------------------------------------------------------------------------

const STATUS = {
  pending:  { label: 'Pending',  tone: 'warn'    },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger'  },
};

const FILTERS = [
  { key: 'pending',  label: 'Pending'  },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all',      label: 'All'      },
];

const formatINR = (n) => {
  const v = Number.parseFloat(n);
  if (!Number.isFinite(v)) return '₹0';
  return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

const formatWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export default function AdminDonationsScreen() {
  const router = useRouter();

  const [filter,      setFilter]      = useState('pending');
  const [donations,   setDonations]   = useState([]);
  const [summary,     setSummary]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState(null);
  const [actioningId, setActioningId] = useState(null);
  const [previewUri,  setPreviewUri]  = useState(null);
  const [rejectFor,   setRejectFor]   = useState(null);   // { id, name }
  const [rejectReason,setRejectReason]= useState('');

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [listRes, summaryRes] = await Promise.all([
        donationsApi.listAll({ page: 1, limit: 100, status: filter === 'all' ? undefined : filter }),
        donationsApi.getSummary(),
      ]);
      if (listRes.success)    setDonations(listRes.data.donations || []);
      if (summaryRes.success) setSummary(summaryRes.data);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load donations right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleVerify = (id, name, amount) => {
    Alert.alert(
      'Verify donation?',
      `Confirm ${formatINR(amount)} from ${name}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Verify',
          onPress: async () => {
            setActioningId(id);
            try {
              await donationsApi.verify(id);
              // Remove from view if the current filter no longer matches
              setDonations((prev) =>
                filter === 'all'
                  ? prev.map((d) => (d.id === id ? { ...d, status: 'verified' } : d))
                  : prev.filter((d) => d.id !== id)
              );
              load();
            } catch (err) {
              Alert.alert("Couldn't verify", err?.response?.data?.message || 'Try again in a moment.');
            } finally {
              setActioningId(null);
            }
          },
        },
      ]
    );
  };

  const openRejectSheet = (id, name) => {
    setRejectReason('');
    setRejectFor({ id, name });
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    const id = rejectFor.id;
    setActioningId(id);
    try {
      await donationsApi.reject(id, rejectReason.trim() || undefined);
      setDonations((prev) =>
        filter === 'all'
          ? prev.map((d) => (d.id === id ? { ...d, status: 'rejected', rejection_reason: rejectReason.trim() || null } : d))
          : prev.filter((d) => d.id !== id)
      );
      setRejectFor(null);
      setRejectReason('');
      load();
    } catch (err) {
      Alert.alert("Couldn't reject", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setActioningId(null);
    }
  };

  const pendingCount = summary?.counts?.pending ?? 0;

  const renderItem = ({ item }) => {
    const cfg = STATUS[item.status] || STATUS.pending;
    const isBusy = actioningId === item.id;

    return (
      <Card>
        <View style={styles.headRow}>
          <Avatar name={item.user?.name} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.user?.name || 'Unknown'}</Text>
            <Text style={styles.phone}>{item.user?.phone || ''}</Text>
          </View>
          <View style={styles.amountBox}>
            <Text style={styles.amountText}>{formatINR(item.amount)}</Text>
          </View>
        </View>

        {item.note ? <Text style={styles.note}>{item.note}</Text> : null}

        {/* Screenshot preview — tap to open full-size */}
        {item.screenshot_url ? (
          <Pressable
            onPress={() => setPreviewUri(item.screenshot_url)}
            style={({ pressed }) => [styles.screenshotBlock, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="View payment screenshot"
          >
            <Image
              source={{ uri: item.screenshot_url }}
              style={styles.screenshotImg}
              resizeMode="cover"
            />
            <View style={styles.screenshotOverlay}>
              <Ionicons name="expand-outline" size={16} color={colors.paper} />
              <Text style={styles.screenshotOverlayText}>Tap to view</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.noScreenshot}>
            <Ionicons name="image-outline" size={16} color={colors.inkFaint} />
            <Text style={styles.noScreenshotText}>No screenshot attached</Text>
          </View>
        )}

        <View style={styles.footer}>
          <Chip label={cfg.label} tone={cfg.tone} />
          <Text style={styles.when}>{formatWhen(item.created_at)}</Text>
        </View>

        {item.status === 'rejected' && item.rejection_reason ? (
          <View style={styles.rejectShown}>
            <Ionicons name="information-circle-outline" size={13} color={colors.danger} />
            <Text style={styles.rejectShownText}>{item.rejection_reason}</Text>
          </View>
        ) : null}

        {item.status === 'pending' && (
          <View style={styles.actions}>
            <Button
              label="Verify"
              onPress={() => handleVerify(item.id, item.user?.name || 'donor', item.amount)}
              loading={isBusy}
              size="sm"
              icon="checkmark"
              style={{ flex: 1 }}
            />
            <Button
              label="Reject"
              onPress={() => openRejectSheet(item.id, item.user?.name || 'donor')}
              loading={isBusy}
              variant="secondary"
              size="sm"
              icon="close"
              style={{ flex: 1 }}
            />
          </View>
        )}
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Donations" onBack={() => router.back()} />

      {/* Hero total */}
      {summary && (
        <View style={styles.heroWrap}>
          <View style={styles.heroCard}>
            <Text style={styles.heroEyebrow}>Total verified</Text>
            <Text style={styles.heroAmount}>{formatINR(summary.total_amount)}</Text>
            <View style={styles.heroFooter}>
              <View style={styles.heroFooterItem}>
                <View style={[styles.pulse, { backgroundColor: colors.warn }]} />
                <Text style={styles.heroFooterText}>
                  {pendingCount} pending
                  {summary.pending_amount > 0 ? ` · ${formatINR(summary.pending_amount)}` : ''}
                </Text>
              </View>
              <View style={styles.heroFooterItem}>
                <View style={[styles.pulse, { backgroundColor: colors.success }]} />
                <Text style={styles.heroFooterText}>{summary.counts?.verified ?? 0} verified</Text>
              </View>
            </View>
          </View>
        </View>
      )}

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
        <LoadingState message="Loading donations…" />
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
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="wallet-outline"
              title={filter === 'pending' ? 'Nothing to review' : `No ${filter === 'all' ? '' : filter + ' '}donations`}
              message={filter === 'pending' ? 'When new donations come in, they\'ll show up here.' : 'Nothing matches this filter right now.'}
            />
          }
        />
      )}

      {/* Full-size screenshot modal */}
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
            <Image source={{ uri: previewUri }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
        </View>
      </Modal>

      {/* Reject-with-reason bottom sheet */}
      <Modal
        visible={!!rejectFor}
        transparent
        animationType="slide"
        onRequestClose={() => setRejectFor(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetOverlay}
        >
          <Pressable style={styles.sheetBackdrop} onPress={() => setRejectFor(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetGrip} />
            <Text style={styles.sheetTitle}>Reject donation?</Text>
            <Text style={styles.sheetBody}>
              You can share an optional reason so {rejectFor?.name || 'the donor'} understands.
            </Text>
            <Input
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="e.g. Screenshot is unreadable"
              multiline
              maxLength={500}
            />
            <View style={styles.sheetActions}>
              <Button label="Cancel" onPress={() => setRejectFor(null)} variant="secondary" style={{ flex: 1 }} />
              <Button label="Reject donation" onPress={submitReject} loading={actioningId === rejectFor?.id} icon="close" style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const WINDOW = Dimensions.get('window');

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  // Hero
  heroWrap: { padding: space[4], paddingBottom: 0 },
  heroCard: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.goldBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space[5],
  },
  heroEyebrow:  { ...type.micro, color: colors.gold, fontWeight: '700', marginBottom: space[1] },
  heroAmount:   { fontSize: 32, fontWeight: '800', color: colors.ink, letterSpacing: -0.6 },
  heroFooter:   { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], marginTop: space[3] },
  heroFooterItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pulse: { width: 8, height: 8, borderRadius: 4 },
  heroFooterText: { ...type.meta, color: colors.inkMuted },

  // Filter
  filterRow: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3], flexWrap: 'wrap' },

  list: { padding: space[4], paddingBottom: space[8] },

  // Card
  headRow:   { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
  name:      { ...type.h3 },
  phone:     { ...type.meta, marginTop: 2 },
  amountBox: { backgroundColor: colors.successSoft, paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.md },
  amountText:{ ...type.metaStrong, color: colors.success },

  note: { ...type.body, color: colors.inkMuted, marginBottom: space[2] },

  screenshotBlock: {
    borderRadius: radius.md,
    overflow: 'hidden',
    marginTop: space[2],
    marginBottom: space[3],
    borderWidth: 1,
    borderColor: colors.ruleSoft,
  },
  screenshotImg: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.ruleFaint,
  },
  screenshotOverlay: {
    position: 'absolute',
    bottom: 8, right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(15,23,42,0.6)',
    borderRadius: radius.pill,
    paddingHorizontal: space[2],
    paddingVertical: 4,
  },
  screenshotOverlayText: { ...type.micro, color: colors.paper, fontWeight: '700' },

  noScreenshot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: space[2],
    marginBottom: space[2],
  },
  noScreenshotText: { ...type.meta, fontStyle: 'italic' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  when: { ...type.micro, color: colors.inkGhost },

  rejectShown: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: space[2],
    marginTop: space[2],
  },
  rejectShownText: { flex: 1, ...type.micro, color: colors.danger },

  actions: {
    flexDirection: 'row',
    gap: space[2],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },

  // Preview modal
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewClose: {
    position: 'absolute',
    top: 60, right: 20,
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    zIndex: 10,
  },
  previewImage: {
    width: WINDOW.width,
    height: WINDOW.height * 0.85,
  },

  // Reject sheet
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.5)' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[5],
    paddingBottom: space[8],
    gap: space[3],
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[2],
  },
  sheetTitle: { ...type.h2 },
  sheetBody:  { ...type.body },
  sheetActions: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
});
