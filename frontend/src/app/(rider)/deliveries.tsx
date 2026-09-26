// @ts-nocheck
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderStore } from '../../store/useRiderStore';
import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  LoadingState,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

// -----------------------------------------------------------------------------
// Rider deliveries — the stop queue for today's optimized route.
//
// One row per assigned PG (delivery_stop on the backend). Rows render
// in `sort_order` — Google Directions' optimized visit order (recomputed
// at assign time, on Start delivery, and after each mark-delivered).
//
// The map screen visualises the SAME data as a route polyline + numbered
// pins; this screen is the tap-to-mark queue. Both read from
// useRiderStore.myStops so state stays consistent.
// -----------------------------------------------------------------------------

export default function DeliveriesScreen() {
  const fetchMyStops       = useRiderStore((s) => s.fetchMyStops);
  const markStopDelivered  = useRiderStore((s) => s.markStopDelivered);
  const undoStopDelivered  = useRiderStore((s) => s.undoStopDelivered);
  const stops              = useRiderStore((s) => s.myStops);
  const summary            = useRiderStore((s) => s.stopsSummary);
  const loading            = useRiderStore((s) => s.loadingStops);
  const error              = useRiderStore((s) => s.stopsError);

  const [refreshing, setRefreshing] = useState(false);
  const [busyStopId, setBusyStopId] = useState(null);

  useFocusEffect(useCallback(() => { fetchMyStops(); }, [fetchMyStops]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMyStops();
    setRefreshing(false);
  };

  const handleMarkDelivered = (stop) => {
    if (stop.status === 'delivered') return;
    Alert.alert(
      `Mark "${stop.location_name}" as delivered?`,
      `${stop.packet_count} packet${stop.packet_count === 1 ? '' : 's'} for this PG. Users here will get a "delivered" notification.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark delivered',
          onPress: async () => {
            setBusyStopId(stop.id);
            try {
              await markStopDelivered(stop.id);
            } catch (err) {
              Alert.alert("Couldn't mark delivered", err?.response?.data?.message || 'Try again in a moment.');
            } finally {
              setBusyStopId(null);
            }
          },
        },
      ]
    );
  };

  const handleUndoDelivered = (stop) => {
    Alert.alert(
      `Put "${stop.location_name}" back?`,
      'It returns to your route and the residents are told it is still on the way.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Put back',
          onPress: async () => {
            setBusyStopId(stop.id);
            try {
              await undoStopDelivered(stop.id);
            } catch (err) {
              Alert.alert("Couldn't undo", err?.response?.data?.message || 'Try again in a moment.');
            } finally {
              setBusyStopId(null);
            }
          },
        },
      ]
    );
  };

  // Sort: pending (by sort_order) first, then delivered (in delivered_at
  // desc — most recent completion sits at the top of the "done" section
  // so it's easy to spot / undo mentally).
  const orderedStops = [...(stops || [])].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    if (a.status === 'pending') {
      const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      return ao - bo;
    }
    return (b.delivered_at || '').localeCompare(a.delivered_at || '');
  });

  const renderItem = ({ item, index }) => {
    const isDone = item.status === 'delivered';
    const busy   = busyStopId === item.id;
    // Visible stop number = position in the pending queue. Delivered
    // rows show a checkmark badge instead so numbering stays stable.
    const visibleIndex = orderedStops
      .filter((s) => s.status === 'pending')
      .findIndex((s) => s.id === item.id) + 1;

    return (
      <Card style={isDone ? styles.cardDone : undefined} padding={false}>
        <View style={styles.rowInner}>
          {/* Number / checkmark badge */}
          <View style={[styles.numBadge, isDone && styles.numBadgeDone]}>
            {isDone
              ? <Ionicons name="checkmark" size={16} color={colors.paper} />
              : <Text style={styles.numText}>{visibleIndex || index + 1}</Text>}
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.pgName, isDone && styles.textMuted]} numberOfLines={2}>
              {item.location_name}
            </Text>
            <View style={styles.metaRow}>
              <Ionicons name="people-outline" size={13} color={colors.inkFaint} />
              <Text style={[styles.metaText, isDone && styles.textMuted]}>
                {item.packet_count} packet{item.packet_count === 1 ? '' : 's'}
              </Text>
              {!item.has_pin && !isDone && (
                <Chip label="No pin" tone="warn" />
              )}
              {isDone && (
                <Chip label="Delivered" tone="success" icon="checkmark-circle-outline" />
              )}
            </View>
          </View>

          {isDone ? (
            // Tappable, because a mistap at 4am used to be permanent — the
            // stop left the route and the residents had already been told
            // their food arrived. Understated so it never competes with the
            // primary action on the rows that still need doing.
            <Pressable
              onPress={() => handleUndoDelivered(item)}
              disabled={busy}
              hitSlop={8}
              style={({ pressed }) => [styles.deliveredWrap, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={`Undo delivery of ${item.location_name}`}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.success} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  <Text style={styles.undoHint}>Undo</Text>
                </>
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={() => handleMarkDelivered(item)}
              disabled={busy}
              style={({ pressed }) => [
                styles.markBtn,
                pressed && styles.markBtnPressed,
                busy && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Mark ${item.location_name} delivered`}
            >
              <Ionicons name="checkmark" size={16} color={colors.paper} />
              <Text style={styles.markBtnText}>{busy ? 'Saving…' : 'Delivered'}</Text>
            </Pressable>
          )}
        </View>
      </Card>
    );
  };

  if (loading && !refreshing && (!stops || stops.length === 0)) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Deliveries" />
        <LoadingState message="Loading today's stops…" />
      </SafeAreaView>
    );
  }

  if (error) {
    const notAssigned = error.toLowerCase().includes('not assigned') || error.toLowerCase().includes("haven't been");
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Deliveries" />
        {notAssigned ? (
          <EmptyState
            icon="calendar-outline"
            title="Not assigned today"
            message="You haven't been assigned any stops today. Check with the coordinator."
            actionLabel="Refresh"
            onAction={fetchMyStops}
          />
        ) : (
          <ErrorState message={error} onRetry={fetchMyStops} />
        )}
      </SafeAreaView>
    );
  }

  if (!stops || stops.length === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Deliveries" />
        <EmptyState
          icon="checkmark-done-circle-outline"
          title="No stops"
          message="You haven't been assigned any PGs today."
          actionLabel="Refresh"
          onAction={fetchMyStops}
        />
      </SafeAreaView>
    );
  }

  const s = summary || {
    total_stops: stops.length,
    delivered_stops: stops.filter((x) => x.status === 'delivered').length,
    pending_stops: stops.filter((x) => x.status === 'pending').length,
    total_packets: stops.reduce((n, x) => n + (x.packet_count || 0), 0),
    delivered_packets: stops.filter((x) => x.status === 'delivered').reduce((n, x) => n + (x.packet_count || 0), 0),
  };

  const allDone = s.pending_stops === 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Deliveries" subtitle={`${s.pending_stops} of ${s.total_stops} left`} />

      {/* Summary strip — matches the aesthetic of admin dashboards' StatCells */}
      <View style={styles.summaryStrip}>
        <SummaryCell label="Stops"       value={s.pending_stops}    total={s.total_stops}       color={allDone ? colors.success : colors.tealDark} />
        <View style={styles.summaryDivider} />
        <SummaryCell label="Packets"     value={s.delivered_packets} total={s.total_packets}    color={colors.gold} suffix="delivered" />
        <View style={styles.summaryDivider} />
        <SummaryCell label="Done"        value={s.delivered_stops}   total={s.total_stops}      color={colors.success} />
      </View>

      {allDone && (
        <View style={styles.doneBanner}>
          <Ionicons name="ribbon-outline" size={16} color={colors.success} />
          <Text style={styles.doneBannerText}>
            All stops delivered. Jazak-Allahu-khayran — you can stop delivery from the Map tab.
          </Text>
        </View>
      )}

      <FlatList
        data={orderedStops}
        keyExtractor={(x) => x.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

function SummaryCell({ label, value, total, color, suffix }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryValueRow}>
        <Text style={[styles.summaryValue, { color }]}>{value}</Text>
        {total != null && <Text style={styles.summaryTotal}> / {total}</Text>}
      </Text>
      <Text style={styles.summaryLabel}>{suffix || label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  summaryStrip: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
  },
  summaryCell:    { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: colors.ruleSoft, marginVertical: 4 },
  summaryValueRow:{ alignItems: 'baseline' },
  summaryValue:   { fontSize: 22, fontWeight: '800' },
  summaryTotal:   { fontSize: 13, color: colors.inkFaint, fontWeight: '600' },
  summaryLabel:   { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.successSoft,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.success,
  },
  doneBannerText: { ...type.meta, color: colors.success, flex: 1, fontWeight: '700' },

  list: { padding: space[4], paddingBottom: space[8] },

  cardDone: { opacity: 0.7, backgroundColor: colors.paper },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[4],
  },

  numBadge: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.tealSoft,
    borderWidth: 1.5, borderColor: colors.tealBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  numBadgeDone: { backgroundColor: colors.success, borderColor: colors.success },
  numText:      { ...type.bodyStrong, color: colors.tealDark, fontVariant: ['tabular-nums'] },

  pgName:    { ...type.h3 },
  textMuted: { color: colors.inkGhost, textDecorationLine: 'line-through' },

  metaRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: space[2],
    marginTop: 4, flexWrap: 'wrap',
  },
  metaText: { ...type.meta, color: colors.inkMuted },

  markBtn: {
    flexDirection: 'row', alignItems: 'center',
    gap: 6,
    backgroundColor: colors.teal,
    paddingHorizontal: space[3], paddingVertical: space[2],
    borderRadius: radius.md,
  },
  markBtnPressed: { backgroundColor: colors.tealDark },
  markBtnText:    { ...type.metaStrong, color: colors.paper },

  undoHint: { ...type.micro, color: colors.inkFaint, marginTop: 2 },
  deliveredWrap: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
  },
});
