import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { adminApi } from '../../api/admin';
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

const TABS = [
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_TONE = {
  pending:  'warn',
  approved: 'success',
  rejected: 'danger',
};

// Walk the eager-loaded location chain to find the zone name.
const resolveZoneName = (location) => {
  let cur = location; let hops = 0;
  while (cur && cur.type !== 'zone' && hops < 10) { cur = cur.parent || null; hops += 1; }
  return cur?.type === 'zone' ? cur.name : null;
};

export default function AdminUsersScreen() {
  const [activeTab,   setActiveTab]   = useState('pending');
  const [users,       setUsers]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState(null);
  const [actioningId, setActioningId] = useState(null);

  const load = useCallback(async (tab = activeTab, isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getUsers(tab);
      if (res.success) setUsers(res.data);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load users. Try again in a moment.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab]);

  useFocusEffect(useCallback(() => { load(activeTab); }, [activeTab]));

  const handleAction = (userId, status, name) => {
    const verb = status === 'approved' ? 'approve' : 'reject';
    Alert.alert(
      `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${name}?`,
      status === 'approved'
        ? `${name} will be able to sign in and vote.`
        : `${name} won't be able to sign in until you approve them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb.charAt(0).toUpperCase() + verb.slice(1),
          style: status === 'rejected' ? 'destructive' : 'default',
          onPress: async () => {
            setActioningId(userId);
            try {
              await adminApi.updateUserStatus(userId, status);
              setUsers((prev) => prev.filter((u) => u.id !== userId));
            } catch (err) {
              Alert.alert("Couldn't save", err?.response?.data?.message || 'Try again.');
            } finally {
              setActioningId(null);
            }
          },
        },
      ]
    );
  };

  const renderUser = ({ item }) => {
    const zone = resolveZoneName(item.location);
    const isActioning = actioningId === item.id;

    return (
      <Card>
        <View style={styles.headRow}>
          <Avatar name={item.name} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{item.name}</Text>
            <Text style={styles.userPhone}>{item.phone}</Text>
          </View>
          <Chip label={item.status} tone={STATUS_TONE[item.status] || 'neutral'} />
        </View>

        <View style={styles.metaRow}>
          {zone ? <MetaChip icon="location-outline" text={zone} /> : null}
          {item.gender ? <MetaChip icon="person-outline" text={item.gender} /> : null}
          {item.occupation ? <MetaChip icon="briefcase-outline" text={item.occupation} /> : null}
        </View>

        {item.address ? (
          <View style={styles.addressRow}>
            <Ionicons name="home-outline" size={13} color={colors.inkFaint} />
            <Text style={styles.addressText} numberOfLines={2}>{item.address}</Text>
          </View>
        ) : null}

        {item.status === 'pending' && (
          <View style={styles.actions}>
            <Button
              label="Approve"
              onPress={() => handleAction(item.id, 'approved', item.name)}
              loading={isActioning}
              size="sm"
              icon="checkmark"
              style={{ flex: 1 }}
            />
            <Button
              label="Reject"
              onPress={() => handleAction(item.id, 'rejected', item.name)}
              loading={isActioning}
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
      <Header
        title="Users"
        trailing={
          <Pressable onPress={() => load(activeTab, true)} hitSlop={8} accessibilityLabel="Refresh">
            <Ionicons name="refresh" size={22} color={colors.teal} />
          </Pressable>
        }
      />

      {/* Tabs */}
      <View style={styles.tabRow}>
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setActiveTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <LoadingState message={`Loading ${activeTab} users…`} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load(activeTab)} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={renderUser}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space[2] }} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(activeTab, true)} colors={[colors.teal]} tintColor={colors.teal} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={`No ${activeTab} users`}
              message={
                activeTab === 'pending'
                  ? "Nobody's waiting for approval right now."
                  : `Nobody is currently ${activeTab}.`
              }
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function MetaChip({ icon, text }) {
  return (
    <View style={styles.metaChip}>
      <Ionicons name={icon} size={11} color={colors.inkFaint} />
      <Text style={styles.metaChipText} numberOfLines={1}>{text}</Text>
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
  tab: {
    flex: 1,
    paddingVertical: space[3],
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive:      { borderBottomColor: colors.teal },
  tabLabel:       { ...type.body, fontWeight: '600', color: colors.inkFaint },
  tabLabelActive: { color: colors.teal, fontWeight: '700' },

  list: { padding: space[4], paddingBottom: space[8] },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[3] },
  userName:  { ...type.h3 },
  userPhone: { ...type.meta, marginTop: 2 },

  metaRow: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap', marginBottom: space[2] },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: space[2], paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.ruleFaint,
  },
  metaChipText: { ...type.micro, color: colors.inkMuted, textTransform: 'capitalize' },

  addressRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: space[1] },
  addressText: { flex: 1, ...type.meta },

  actions: {
    flexDirection: 'row',
    gap: space[2],
    marginTop: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.ruleFaint,
  },
});
