import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRiderStore } from '../../store/useRiderStore';

const ZONE_LABELS: Record<string, string> = {
  masjid:      'Masjid',
  boys_hostel: 'Boys Hostel',
  stanza:      'Stanza Living',
  girls:       'Girls Accommodation',
};

// ---------------------------------------------------------------------------
// Build display data from by_zone:
//
// Structure shown:
//   MASJID  (5)
//     Balaji PG for Gents  ×2  [checkbox]
//     Global Vista         ×1  [checkbox]
//   BOYS HOSTEL  (1)
//     Paras Global Kutir   ×1  [checkbox]
//
// Each zone header shows total for that zone.
// Each PG row shows how many deliveries go to that address, with a checkbox.
// No individual resident names shown.
// ---------------------------------------------------------------------------
const buildListData = (by_zone: Record<string, any[]>) => {
  const items: any[] = [];

  for (const [zone, responses] of Object.entries(by_zone)) {
    // Group responses by address within this zone
    const byAddress: Record<string, { count: number; responseIds: string[]; isSpecial: boolean }> = {};

    for (const r of responses) {
      const addr = r.address || 'Unknown address';
      if (!byAddress[addr]) {
        byAddress[addr] = { count: 0, responseIds: [], isSpecial: false };
      }
      byAddress[addr].count++;
      byAddress[addr].responseIds.push(r.response_id);
      if (r.is_special_case) byAddress[addr].isSpecial = true;
    }

    // Zone header
    items.push({
      type:  'zone_header',
      zone,
      total: responses.length,
      key:   `header-${zone}`,
    });

    // PG rows
    for (const [address, data] of Object.entries(byAddress)) {
      items.push({
        type:        'pg_row',
        zone,
        address,
        count:       data.count,
        responseIds: data.responseIds,
        isSpecial:   data.isSpecial,
        key:         `pg-${zone}-${address}`,
      });
    }
  }

  return items;
};

export default function DeliveriesScreen() {
  const fetchDeliveryList = useRiderStore((state) => state.fetchDeliveryList);
  const deliveryList      = useRiderStore((state) => state.deliveryList);
  const loadingList       = useRiderStore((state) => state.loadingList);
  const listError         = useRiderStore((state) => state.listError);

  // Checkbox state per PG (keyed by "zone-address")
  const [delivered, setDelivered] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      fetchDeliveryList();
    }, [fetchDeliveryList])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDeliveryList();
    setRefreshing(false);
  };

  const toggleDelivered = (key: string) => {
    setDelivered((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const listData = deliveryList?.by_zone ? buildListData(deliveryList.by_zone) : [];

  const completedCount = Object.values(delivered).filter(Boolean).length;
  const totalPGs = listData.filter((i) => i.type === 'pg_row').length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const renderItem = ({ item }: { item: any }) => {
    if (item.type === 'zone_header') {
      return (
        <View style={styles.zoneHeader}>
          <Ionicons name="location" size={15} color="#0D9488" />
          <Text style={styles.zoneHeaderText}>
            {ZONE_LABELS[item.zone] || item.zone}
          </Text>
          <View style={styles.zoneCountBadge}>
            <Text style={styles.zoneCountText}>{item.total}</Text>
          </View>
        </View>
      );
    }

    // PG row
    const isDone = delivered[item.key];

    return (
      <TouchableOpacity
        style={[styles.pgRow, isDone && styles.pgRowDone]}
        onPress={() => toggleDelivered(item.key)}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDone }}
        accessibilityLabel={`Mark ${item.address} as ${isDone ? 'not delivered' : 'delivered'}`}
      >
        <View style={styles.pgRowLeft}>
          {item.isSpecial && (
            <View style={styles.specialBadge}>
              <Text style={styles.specialBadgeText}>Special</Text>
            </View>
          )}
          <Text style={[styles.pgName, isDone && styles.textDone]} numberOfLines={2}>
            {item.address}
          </Text>
          <Text style={[styles.pgCount, isDone && styles.textDone]}>
            {item.count} {item.count === 1 ? 'person' : 'people'}
          </Text>
        </View>

        <View style={[styles.checkbox, isDone && styles.checkboxDone]}>
          {isDone && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
        </View>
      </TouchableOpacity>
    );
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loadingList && !refreshing) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Deliveries</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0D9488" />
          <Text style={styles.loadingText}>Loading today's list...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------
  if (listError) {
    const isNotAssigned = listError.toLowerCase().includes('not assigned');
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Deliveries</Text>
        </View>
        <View style={styles.centered}>
          <Ionicons
            name={isNotAssigned ? 'calendar-outline' : 'alert-circle-outline'}
            size={48}
            color={isNotAssigned ? '#94A3B8' : '#DC2626'}
          />
          <Text style={styles.emptyTitle}>
            {isNotAssigned ? 'Not Assigned Today' : 'Something went wrong'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {isNotAssigned
              ? "You haven't been assigned as today's delivery rider."
              : listError}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchDeliveryList}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  if (!deliveryList || deliveryList.total === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Deliveries</Text>
        </View>
        <View style={styles.centered}>
          <Ionicons name="checkmark-done-circle-outline" size={48} color="#0D9488" />
          <Text style={styles.emptyTitle}>No deliveries today</Text>
          <Text style={styles.emptySubtitle}>No one voted yes for today's Sehri.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Main list
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Deliveries</Text>
        <Text style={styles.headerDate}>{deliveryList.poll_date}</Text>
      </View>

      {/* Summary bar — total people / PGs done / remaining */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{deliveryList.total}</Text>
          <Text style={styles.summaryLabel}>People</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: '#16A34A' }]}>{completedCount}</Text>
          <Text style={styles.summaryLabel}>PGs Done</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, { color: '#D97706' }]}>
            {totalPGs - completedCount}
          </Text>
          <Text style={styles.summaryLabel}>Remaining</Text>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={listData}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#0D9488"
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerDate: {
    fontSize: 13,
    color: '#64748B',
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    marginBottom: 8,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
    fontWeight: '500',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 12,
    gap: 6,
  },
  zoneHeaderText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  zoneCountBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  zoneCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  pgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  pgRowDone: {
    opacity: 0.5,
    backgroundColor: '#F8FAFC',
  },
  pgRowLeft: {
    flex: 1,
    marginRight: 12,
    gap: 3,
  },
  specialBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  specialBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  pgName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
  },
  pgCount: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  textDone: {
    textDecorationLine: 'line-through',
    color: '#94A3B8',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: '#0D9488',
    borderColor: '#0D9488',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 8,
  },
  retryButton: {
    marginTop: 8,
    backgroundColor: '#0D9488',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
});
