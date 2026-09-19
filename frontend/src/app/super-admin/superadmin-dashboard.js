import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/useAuthStore';
import {
  Avatar,
  Chip,
  Header,
  Hero,
  SectionHeader,
} from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

const MENU = [
  { title: 'Users & zones',    icon: 'people-outline',           route: '/super-admin/users',    hint: 'Approve, promote, or remove members' },
  { title: 'Profile requests', icon: 'document-text-outline',    route: '/super-admin/requests', hint: 'Review profile change requests' },
  { title: 'Donations',        icon: 'wallet-outline',           route: '/super-admin/donations',hint: 'Verify contributions' },
  { title: 'Feedback',         icon: 'chatbubble-outline',       route: '/super-admin/feedback', hint: 'Read what the community is saying' },
  { title: 'Poll history',     icon: 'stats-chart-outline',      route: '/super-admin/polls',    hint: 'Past polls and per-zone breakdown' },
  { title: 'Zone admins',      icon: 'shield-checkmark-outline', route: '/super-admin/admins',   hint: 'Add or remove zone admins' },
  { title: 'Group chat',       icon: 'chatbubbles-outline',      route: '/super-admin/chat',     hint: 'Manage broadcast groups' },
];

export default function SuperAdminDashboard() {
  const router          = useRouter();
  const user            = useAuthStore((s) => s.user);
  const available_roles = useAuthStore((s) => s.available_roles);
  const switchRole      = useAuthStore((s) => s.switchRole);

  const firstName = (user?.name || 'Super admin').trim().split(/\s+/)[0];

  const handleSwitch = async (role) => {
    try {
      await switchRole(role);
      if (role === 'user')  router.replace('/(user)');
      if (role === 'admin') router.replace('/(admin)');
    } catch (err) {
      Alert.alert("Couldn't switch role", err?.response?.data?.message || 'Try again in a moment.');
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        leading={<Wordmark />}
        trailing={
          <Avatar name={user?.name} size={38} onPress={() => router.push('/profile')} accessibilityLabel="Open profile" />
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Hero
          greeting="Super admin"
          name={firstName}
          dateLine={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' })}
        />

        {available_roles.length > 1 && (
          <View style={styles.roleRow}>
            <Text style={styles.roleLabel}>Switch to</Text>
            <View style={styles.roleChips}>
              {available_roles.includes('user') && (
                <Chip label="User" tone="teal" icon="person-outline" onPress={() => handleSwitch('user')} />
              )}
              {available_roles.includes('admin') && (
                <Chip label="Zone admin" tone="teal" icon="shield-outline" onPress={() => handleSwitch('admin')} />
              )}
            </View>
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

  roleRow:    { paddingHorizontal: space[5], paddingBottom: space[3], gap: space[2] },
  roleLabel:  { ...type.meta, color: colors.inkFaint },
  roleChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },

  section: { paddingHorizontal: space[4], paddingTop: space[4] },

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
});
