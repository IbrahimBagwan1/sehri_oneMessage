import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/useAuthStore';
import RoleSwitcher from '../../components/RoleSwitcher';
import { adminApi } from '../../api/admin';
import { locationsApi } from '../../api/auth';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Header,
  Hero,
  LoadingState,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

const MENU = [
  { title: 'Users & zones',    icon: 'people-outline',           route: '/super-admin/users',         hint: 'Approve, promote, or remove members' },
  { title: 'Profile requests', icon: 'document-text-outline',    route: '/super-admin/requests',      hint: 'Review profile change requests' },
  { title: 'Donations',        icon: 'wallet-outline',           route: '/super-admin/donations',     hint: 'Verify contributions' },
  { title: 'Feedback',         icon: 'chatbubble-outline',       route: '/super-admin/feedback',      hint: 'Read what the community is saying' },
  { title: 'Polls',            icon: 'stats-chart-outline',      route: '/super-admin/polls',         hint: "Today's controls + past poll history" },
  { title: 'Special cases',    icon: 'alert-circle-outline',     route: '/super-admin/special-cases', hint: 'Review, approve, or reject requests' },
  { title: 'Zone admins',      icon: 'shield-checkmark-outline', route: '/super-admin/admins',        hint: 'Add or remove zone admins' },
  { title: 'Riders',           icon: 'bicycle-outline',          route: '/super-admin/riders',        hint: 'Create, assign, or remove riders' },
  { title: 'Locations',        icon: 'git-branch-outline',       route: '/super-admin/location-tree', hint: 'Add cities, areas, zones and PGs' },
  { title: 'PG coordinates',   icon: 'location-outline',         route: '/super-admin/locations',     hint: 'Set map pins for delivery ETAs' },
  { title: 'Group chat',       icon: 'chatbubbles-outline',      route: '/super-admin/chat',          hint: 'Manage broadcast groups' },
  { title: 'Reported messages', icon: 'flag-outline',            route: '/super-admin/chat-reports',  hint: 'Review and act on reported chat' },
  { title: 'Send broadcast',   icon: 'megaphone-outline',        route: '/super-admin/broadcast',     hint: 'Push a notification to a zone' },
  { title: 'Content sync',     icon: 'sync-outline',             route: '/super-admin/content-sync',  hint: "Refresh prayer times, Qur'an, or duas" },
];

export default function SuperAdminDashboard() {
  const router            = useRouter();
  const user              = useAuthStore((s) => s.user);
  const available_roles   = useAuthStore((s) => s.available_roles);
  const setAvailableRoles = useAuthStore((s) => s.setAvailableRoles);

  // Full name, not just the first word — consistent with the user and
  // admin dashboards.
  const displayName = (user?.name || 'Super admin').trim().replace(/\s+/g, ' ');

  // Whether this super-admin holds any other role. Only used to decide
  // between the header switcher (RoleSwitcher renders itself when there is
  // something to switch to) and the "link an account" prompt below.
  const otherRoles = available_roles.filter((r) => r !== 'super_admin');

  // Link-user-account sheet state
  const [linkOpen,     setLinkOpen]     = useState(false);
  const [zones,        setZones]        = useState([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [pickedZoneId, setPickedZoneId] = useState(null);
  const [linking,      setLinking]      = useState(false);

  // Lazy-load zones the first time the sheet opens.
  useEffect(() => {
    if (!linkOpen || zones.length > 0) return;
    (async () => {
      setZonesLoading(true);
      try {
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch { setZones([]); }
      finally  { setZonesLoading(false); }
    })();
  }, [linkOpen, zones.length]);

  const handleLinkSubmit = async () => {
    if (!pickedZoneId) return;
    setLinking(true);
    try {
      const res = await adminApi.linkUserAccount({ location_id: pickedZoneId });
      if (res.success) {
        // Refresh the store's role list without needing a re-login.
        await setAvailableRoles(res.data.available_roles);
        setLinkOpen(false);
        setPickedZoneId(null);
        Alert.alert('Linked', res.message);
      }
    } catch (err) {
      Alert.alert("Couldn't link", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header
        leading={<Wordmark />}
        trailing={
          <View style={styles.headerActions}>
            <RoleSwitcher fallbackRole="super_admin" />
            <Avatar name={user?.name} size={38} onPress={() => router.push('/profile')} accessibilityLabel="Open profile" />
          </View>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Hero
          greeting="Super admin"
          name={displayName}
          dateLine={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' })}
        />

        {/* Switching roles lives in the header (see RoleSwitcher). What's
            left here is the case where there is nothing to switch to yet: a
            standalone super-admin holds no linked user or admin account, so
            we prompt them to create one, which unlocks the header switcher.
            That's onboarding, not a switcher, so it stays a card in the body.
            See POST /api/admin/link-user-account. */}
        {otherRoles.length === 0 && (
          <View style={styles.section}>
            <Card tone="warm">
              <View style={styles.linkCardRow}>
                <View style={styles.linkCardIcon}>
                  <Ionicons name="swap-horizontal-outline" size={20} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkCardTitle}>Enable role switching</Text>
                  <Text style={styles.linkCardBody}>
                    You don't have a linked user account yet. Link one to switch to the
                    user view and take part in polls, tracking, and chat.
                  </Text>
                </View>
              </View>
              <Button
                label="Link a user account"
                onPress={() => setLinkOpen(true)}
                icon="link-outline"
                size="sm"
                style={{ marginTop: space[3], alignSelf: 'flex-start' }}
              />
            </Card>
          </View>
        )}

        <View style={styles.section}>
          <SectionHeader title="Manage community" ornament="star" />
          <View style={styles.list}>
            {MENU.map((item, i) => (
              <React.Fragment key={item.route}>
                {i > 0 && <View style={styles.rowRule} />}
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => router.push(item.route)}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name={item.icon} size={20} color={colors.tealDark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Text style={styles.rowHint} numberOfLines={1}>{item.hint}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.inkGhost} />
                </Pressable>
              </React.Fragment>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* --------------- Link-user-account bottom sheet --------------- */}
      <Modal
        visible={linkOpen}
        animationType="slide"
        transparent
        onRequestClose={() => (linking ? null : setLinkOpen(false))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Link a user account</Text>
            <Text style={styles.modalBody}>
              This creates a user record for {user?.name || 'you'} in the zone you pick,
              reusing your existing password. You'll be able to switch between roles
              from the dashboard.
            </Text>

            <Text style={styles.modalLabel}>Pick your zone</Text>
            {zonesLoading ? (
              <LoadingState message="Loading zones…" compact />
            ) : zones.length === 0 ? (
              <Text style={styles.modalEmpty}>No zones available.</Text>
            ) : (
              <View style={styles.zoneChips}>
                {zones.map((z) => (
                  <Chip
                    key={z.id}
                    label={z.name}
                    tone={pickedZoneId === z.id ? 'teal' : 'neutral'}
                    selected={pickedZoneId === z.id}
                    icon="location-outline"
                    onPress={() => setPickedZoneId(z.id)}
                  />
                ))}
              </View>
            )}

            <View style={styles.modalActions}>
              <Button label="Cancel" onPress={() => setLinkOpen(false)} variant="secondary" style={{ flex: 1 }} disabled={linking} />
              <Button
                label={linking ? 'Linking…' : 'Link account'}
                onPress={handleLinkSubmit}
                loading={linking}
                disabled={!pickedZoneId || linking}
                icon="checkmark"
                style={{ flex: 1.2 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Wordmark() {
  return (
    <View style={styles.wordmarkRow}>
      <View style={styles.wordmarkDot} />
      <Text style={styles.wordmark}>OneMessage</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { paddingBottom: space[8] },

  wordmarkRow: { flexDirection: 'row', alignItems: 'center' },
  wordmarkDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal, marginRight: space[2] },
  wordmark:    { fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },

  // Role switching moved into the Header; this row holds what sits there now.
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space[2] },

  section: { paddingHorizontal: space[4], paddingTop: space[4] },

  // Link-user-account inline card
  linkCardRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  linkCardIcon: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.paper,
    borderWidth: 1, borderColor: colors.goldBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  linkCardTitle:{ ...type.h3 },
  linkCardBody: { ...type.body, marginTop: 4 },

  list: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  rowPressed: { backgroundColor: colors.tealSoft },
  rowRule: { height: 1, backgroundColor: colors.ruleFaint, marginLeft: space[4] + 40 + space[3] },
  rowIcon: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { ...type.bodyStrong },
  rowHint:  { ...type.meta, marginTop: 2 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[5],
    gap: space[3],
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.ruleSoft,
    marginBottom: space[2],
  },
  modalTitle: { ...type.h2, textAlign: 'center' },
  modalBody:  { ...type.body, color: colors.inkMuted, textAlign: 'center' },
  modalLabel: { ...type.metaStrong, color: colors.inkMuted, marginTop: space[2] },
  modalEmpty: { ...type.meta, color: colors.inkFaint },
  zoneChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  modalActions: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
});
