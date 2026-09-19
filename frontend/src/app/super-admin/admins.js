import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Alert,
  RefreshControl,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../api/client';
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

// -----------------------------------------------------------------------------
// Super admin — Zone admin management. Backed by the real /api/admin/*
// endpoints (list-admins + delete). Add-admin is a follow-up screen.
// -----------------------------------------------------------------------------

export default function SuperAdminAdminsScreen() {
  const router = useRouter();

  const [admins, setAdmins]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [busyId, setBusyId]         = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/list-admins');
      if (res.data.success) setAdmins(res.data.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Couldn't load zone admins.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRemove = (id, name) => {
    Alert.alert(
      `Remove ${name}?`,
      "Their admin access is revoked. Their user account (if any) stays intact.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyId(id);
            try {
              await apiClient.delete(`/admin/admins/${id}`);
              setAdmins((prev) => prev.filter((a) => a.id !== id));
            } catch (err) {
              Alert.alert("Couldn't remove", err?.response?.data?.message || 'Try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  // Group admins by zone for a cleaner list.
  const grouped = admins.reduce((acc, a) => {
    const zoneName = a.zone?.name || 'Unassigned';
    (acc[zoneName] = acc[zoneName] || []).push(a);
    return acc;
  }, {});

  const sections = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  const renderAdmin = (a) => {
    const isBusy = busyId === a.id;
    return (
      <View key={a.id} style={styles.adminRow}>
        <Avatar name={a.name} size={36} />
        <View style={{ flex: 1 }}>
          <View style={styles.adminHead}>
            <Text style={styles.adminName}>{a.name}</Text>
            {a.user_id ? <Chip label="Also a user" tone="teal" /> : null}
          </View>
          <Text style={styles.adminPhone}>{a.phone}</Text>
        </View>
        <Button
          label="Remove"
          onPress={() => handleRemove(a.id, a.name)}
          loading={isBusy}
          variant="ghost"
          size="sm"
          icon="trash-outline"
        />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Zone admins"
        onBack={() => router.back()}
        trailing={
          <Pressable onPress={() => load(true)} hitSlop={8} accessibilityLabel="Refresh">
            <Ionicons name="refresh" size={22} color={colors.teal} />
          </Pressable>
        }
      />

      {loading ? (
        <LoadingState message="Loading zone admins…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : admins.length === 0 ? (
        <EmptyState
          icon="shield-outline"
          title="No zone admins yet"
          message="Add zone admins via the backend or the admin creation endpoint. Once added, they'll appear here grouped by zone."
        />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={([zoneName]) => zoneName}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.teal]} tintColor={colors.teal} />}
          renderItem={({ item: [zoneName, zoneAdmins] }) => (
            <View style={{ marginBottom: space[4] }}>
              <View style={styles.groupHeader}>
                <Ionicons name="location-outline" size={13} color={colors.gold} />
                <Text style={styles.groupTitle}>{zoneName}</Text>
                <View style={styles.groupCount}>
                  <Text style={styles.groupCountText}>{zoneAdmins.length}</Text>
                </View>
              </View>
              <Card padding={false}>
                {zoneAdmins.map((a, i) => (
                  <React.Fragment key={a.id}>
                    {i > 0 && <View style={styles.rowRule} />}
                    <View style={{ paddingHorizontal: space[4], paddingVertical: space[3] }}>
                      {renderAdmin(a)}
                    </View>
                  </React.Fragment>
                ))}
              </Card>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },

  list: { padding: space[4], paddingBottom: space[8] },

  groupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space[2],
    paddingVertical: space[2],
    marginBottom: space[2],
  },
  groupTitle: { ...type.metaStrong, color: colors.inkMuted, flex: 1 },
  groupCount: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  groupCountText: { ...type.micro, color: colors.gold, fontWeight: '700' },

  rowRule:    { height: 1, backgroundColor: colors.ruleFaint, marginLeft: space[4] },
  adminRow:   { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  adminHead:  { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  adminName:  { ...type.bodyStrong },
  adminPhone: { ...type.meta, marginTop: 2 },
});
