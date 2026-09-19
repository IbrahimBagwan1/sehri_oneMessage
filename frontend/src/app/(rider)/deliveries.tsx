// @ts-nocheck
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
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

const ZONE_LABELS: Record<string, string> = {
  masjid:      'Masjid',
  boys_hostel: "Boys' hostel",
  stanza:      'Stanza',
  girls:       'Girls',
};

// -----------------------------------------------------------------------------
// Rider delivery list — grouped by zone → PG. Each PG shows the count of
// residents and a tappable checkbox to mark it delivered.
// -----------------------------------------------------------------------------

type PGRow = {
  type: 'pg_row';
  key: string;
  zone: string;
  address: string;
  count: number;
  isSpecial: boolean;
};

type ZoneHeader = {
  type: 'zone_header';
  key: string;
  zone: string;
  total: number;
};

type Row = PGRow | ZoneHeader;

const buildListData = (by_zone: Record<string, any[]>): Row[] => {
  const items: Row[] = [];
  for (const [zone, responses] of Object.entries(by_zone)) {
    const byAddress: Record<string, { count: number; isSpecial: boolean }> = {};
    for (const r of responses) {
      const addr = r.address || 'Unknown address';
      if (!byAddress[addr]) byAddress[addr] = { count: 0, isSpecial: false };
      byAddress[addr].count += 1;
      if (r.is_special_case) byAddress[addr].isSpecial = true;
    }
    items.push({ type: 'zone_header', key: `header-${zone}`, zone, total: responses.length });
    for (const [address, data] of Object.entries(byAddress)) {
      items.push({
        type: 'pg_row',
        key: `pg-${zone}-${address}`,
        zone,
        address,
        count: data.count,
        isSpecial: data.isSpecial,
      });
    }
  }
  return items;
};

export default function DeliveriesScreen() {
  const fetchDeliveryList = useRiderStore((s) => s.fetchDeliveryList);
  const deliveryList      = useRiderStore((s) => s.deliveryList);
  const loadingList       = useRiderStore((s) => s.loadingList);
  const listError         = useRiderStore((s) => s.listError);

  const [delivered, setDelivered]   = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { fetchDeliveryList(); }, [fetchDeliveryList]));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDeliveryList();
    setRefreshing(false);
  };

  const toggleDelivered = (key: string) => {
    setDelivered((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const listData: Row[] = deliveryList?.by_zone ? buildListData(deliveryList.by_zone) : [];
  const totalPGs = listData.filter((i) => i.type === 'pg_row').length;
  const doneCount = Object.values(delivered).filter(Boolean).length;

  const renderItem = ({ item }: { item: Row }) => {
    if (item.type === 'zone_header') {
      return (
        <View style={styles.zoneHeader}>
          <Ionicons name="location-outline" size={13} color={colors.gold} />
          <Text style={styles.zoneHeaderText}>{ZONE_LABELS[item.zone] || item.zone}</Text>
          <View style={styles.zoneCount}><Text style={styles.zoneCountText}>{item.total}</Text></View>
        </View>
      );
    }

    const isDone = !!delivered[item.key];
    return (
      <Pressable
        onPress={() => toggleDelivered(item.key)}
        style={({ pressed }) => [styles.pgRow, pressed && styles.pgRowPressed, isDone && styles.pgRowDone]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDone }}
        accessibilityLabel={`${item.address}, mark ${isDone ? 'undelivered' : 'delivered'}`}
      >
        <View style={{ flex: 1 }}>
          {item.isSpecial && (
            <View style={{ marginBottom: space[1] }}>
              <Chip label="Special case" tone="gold" />
            </View>
          )}
          <Text style={[styles.pgName, isDone && styles.textDone]} numberOfLines={2}>{item.address}</Text>
          <Text style={[styles.pgCount, isDone && styles.textDone]}>
            {item.count} {item.count === 1 ? 'person' : 'people'}
          </Text>
        </View>
        <View style={[styles.checkbox, isDone && styles.checkboxDone]}>
          {isDone && <Ionicons name="checkmark" size={15} color={colors.paper} />}
        </View>
      </Pressable>
    );
  };

  if (loadingList && !refreshing) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Deliveries" />
        <LoadingState message="Loading today's list…" />
      </SafeAreaView>
    );
  }

  if (listError) {
    const notAssigned = listError.toLowerCase().includes('not assigned');
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Deliveries" />
        {notAssigned ? (
          <EmptyState
            icon="calendar-outline"
            title="Not assigned today"
            message="You haven't been assigned as today's delivery rider. Check with the coordinator."
            actionLabel="Refresh"
            onAction={fetchDeliveryList}
          />
        ) : (
          <ErrorState message={listError} onRetry={fetchDeliveryList} />
        )}
      </SafeAreaView>
    );
  }

  if (!deliveryList || deliveryList.total === 0) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Deliveries" />
        <EmptyState
          icon="checkmark-done-circle-outline"
          title="No deliveries today"
          message="Nobody voted yes for today's Sehri."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Deliveries" subtitle={deliveryList.poll_date} />

      {/* Summary strip */}
      <View style={styles.summaryStrip}>
        <SummaryCell label="People"    value={deliveryList.total}       color={colors.ink} />
        <View style={styles.summaryDivider} />
        <SummaryCell label="Done"      value={doneCount}                color={colors.success} />
        <View style={styles.summaryDivider} />
        <SummaryCell label="Remaining" value={totalPGs - doneCount}     color={colors.warn} />
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.teal]} tintColor={colors.teal} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

function SummaryCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.summaryCell}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
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
  summaryValue:   { fontSize: 22, fontWeight: '800' },
  summaryLabel:   { ...type.micro, color: colors.inkFaint, marginTop: 2 },

  list: { padding: space[4], paddingBottom: space[8] },

  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[3],
    marginTop: space[2],
  },
  zoneHeaderText: { ...type.metaStrong, color: colors.inkMuted, flex: 1 },
  zoneCount:      { backgroundColor: colors.goldSoft, borderRadius: radius.pill, paddingHorizontal: space[2], paddingVertical: 2, borderWidth: 1, borderColor: colors.goldBorder },
  zoneCountText:  { ...type.micro, color: colors.gold, fontWeight: '700' },

  pgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    marginBottom: space[2],
  },
  pgRowPressed: { backgroundColor: colors.tealSoft },
  pgRowDone:    { opacity: 0.55 },
  pgName:       { ...type.h3 },
  pgCount:      { ...type.meta, marginTop: 2 },
  textDone:     { textDecorationLine: 'line-through', color: colors.inkGhost },

  checkbox: {
    width: 26, height: 26, borderRadius: 6,
    borderWidth: 2, borderColor: colors.ruleSoft,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: space[3],
  },
  checkboxDone: { backgroundColor: colors.teal, borderColor: colors.teal },
});