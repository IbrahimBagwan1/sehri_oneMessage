import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../store/useAuthStore';
import { usersApi } from '../api/users';
import LocationPicker from '../components/LocationPicker';
import {
  Avatar,
  Button,
  Card,
  Chip,
  GuestGate,
  Header,
  Input,
  LoadingState,
  SectionHeader,
  KeyboardAwareScroll
} from '../components/ui';
import { colors, radius, space, type } from '../theme';

// -----------------------------------------------------------------------------
// Profile — read from GET /api/users/me. Edits are submitted as a
// profile-edit request that a super admin approves.
// -----------------------------------------------------------------------------

const OCCUPATIONS = ['student', 'employee', 'others'];
const GENDERS     = ['male', 'female'];

const resolveChain = (location) => {
  const chain = [];
  let cur = location; let hops = 0;
  while (cur && hops < 10) { chain.push(cur); cur = cur.parent || null; hops += 1; }
  return chain;
};

// Wrapper — guests see GuestGate; signed-in users see the real profile.
// Splitting keeps rules-of-hooks intact even when guest state flips.
export default function ProfileScreen() {
  const isGuest = useAuthStore((s) => s.isGuest);
  const router  = useRouter();
  if (isGuest) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.paperSoft }} edges={['top', 'bottom']}>
        <Header title="Profile" onBack={() => router.back()} />
        <GuestGate
          icon="person-add-outline"
          title="You're browsing as guest"
          message="Sign in to see your profile, donation history, feedback, and role settings."
        />
      </SafeAreaView>
    );
  }
  return <ProfileScreenAuthed />;
}

function ProfileScreenAuthed() {
  const router      = useRouter();
  const user        = useAuthStore((s) => s.user);
  const logout      = useAuthStore((s) => s.logout);
  const activeRole  = useAuthStore((s) => s.active_role);

  // Self-delete is a user-account action. DELETE /users/me now removes
  // the linked admin / super_admin / rider rows too (it has to — that is
  // what frees the phone number), so a zone admin tapping this would
  // silently give up their zone. Removing a privileged account stays a
  // deliberate super-admin action from the Zone admins screen. The
  // backend refuses to delete the last active super admin regardless.
  const canDeleteAccount = activeRole === 'user' || activeRole == null;

  const [loading, setLoading]     = useState(true);
  const [profile, setProfile]     = useState(null);
  const [zoneName, setZoneName]   = useState(null);
  // The PG / hostel row the user is registered under, and the readable
  // "PG · Zone · Area · Region · City" trail above it. Both come from
  // the location chain the backend already eager-loads on GET /users/me —
  // read mode used to throw all of it away and show only the zone.
  const [pgName, setPgName]       = useState(null);
  const [locationTrail, setLocationTrail] = useState(null);

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);

  const [name, setName]           = useState('');
  const [gender, setGender]       = useState('');
  const [occupation, setOccupation] = useState('');
  const [address, setAddress]     = useState('');

  // Location editing goes through the shared cascading LocationPicker.
  // `initialChain` pre-expands it to wherever the user already lives;
  // `pickedLocation` is whatever they land on (null until they touch it,
  // so an untouched picker submits no location change).
  const [initialChain, setInitialChain]     = useState(null);
  const [pickedLocation, setPickedLocation] = useState(null);

  const [modalType, setModalType]     = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const res = await usersApi.getMe();
      if (res.success) {
        const u = res.data.user;
        setProfile(u);
        setZoneName(res.data.zone?.name || null);
        setName(u.name || '');
        setGender(u.gender || '');
        setOccupation(u.occupation || '');
        setAddress(u.address || '');
        const chain = resolveChain(u.location);
        const pg = u.location?.type === 'address'
          ? { id: u.location.id, name: u.location.name }
          : null;
        setPgName(pg?.name || null);
        // Root-first chain for the cascading picker to pre-expand from.
        setInitialChain(
          chain.length > 0
            ? chain.map((c) => ({ id: c.id, name: c.name, type: c.type })).reverse()
            : null
        );
        setPickedLocation(null);
        // chain is ordered innermost-first (PG → zone → area → region →
        // city); reverse it so the trail reads broad-to-specific the way
        // an address normally does.
        setLocationTrail(
          chain.length > 1
            ? chain.map((c) => c.name).reverse().join(' · ')
            : null
        );
      }
    } catch (err) {
      Alert.alert("Couldn't load profile", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  const handleSave = async () => {
    if (!profile) return;
    const changes = {};
    if (name.trim() && name.trim() !== profile.name) changes.name = name.trim();
    if (gender && gender !== profile.gender) changes.gender = gender;
    if (occupation && occupation !== profile.occupation) changes.occupation = occupation;
    if (address.trim() && address.trim() !== profile.address) changes.address = address.trim();
    // Only submit a location change if the user actually touched the
    // picker AND landed somewhere different from where they already are.
    if (pickedLocation?.id && pickedLocation.id !== profile.location_id) {
      // Same guard as registration: a location above the zone level
      // can't be routed to, so refuse rather than submitting a request
      // that would break their next vote if approved.
      if (!pickedLocation.hasZone) {
        return Alert.alert(
          'Pick a delivery zone',
          `No delivery zones are set up under ${pickedLocation.name} yet. Pick a different one, or ask an admin to add your PG.`
        );
      }
      changes.location_id = pickedLocation.id;
    }

    if (Object.keys(changes).length === 0) {
      return Alert.alert('Nothing to submit', 'No fields were changed.');
    }
    setSaving(true);
    try {
      await usersApi.requestProfileEdit(changes);
      Alert.alert('Submitted', 'Your changes have been sent to the super admin for approval.');
      setIsEditing(false);
      loadProfile();
    } catch (err) {
      Alert.alert("Couldn't submit changes", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign out?', "You'll need to sign back in to use the app.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'Your account and personal details — name, phone number, address, profile '
        + 'and chat messages — are permanently removed. Nothing is kept on hold, '
        + 'and your number becomes free to register again.\n\n'
        + "The community's records of what happened stay: your past votes still "
        + 'count towards those nights, and verified donations remain in the books. '
        + 'They no longer carry your name.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you sure?',
              "This can't be undone.",
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete forever',
                  style: 'destructive',
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      await usersApi.deleteMe();
                      await logout();
                      router.replace('/(auth)/login');
                    } catch (err) {
                      Alert.alert("Couldn't delete", err?.response?.data?.message || 'Try again in a moment.');
                    } finally { setDeleting(false); }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header title="Profile" onBack={() => router.back()} />
        <LoadingState message="Loading your profile…" />
      </SafeAreaView>
    );
  }

  const openModal = (t) => { if (!isEditing) return; setModalType(t); setModalVisible(true); };
  const modalOptions = modalType === 'gender' ? GENDERS : OCCUPATIONS;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header
        title="Profile"
        onBack={() => router.back()}
        trailing={
          isEditing ? (
            <Pressable onPress={() => { loadProfile(); setIsEditing(false); }} hitSlop={8}>
              <Text style={styles.headerAction}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setIsEditing(true)} hitSlop={8}>
              <Text style={styles.headerAction}>Edit</Text>
            </Pressable>
          )
        }
      />

      <KeyboardAwareScroll contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Identity block */}
        <View style={styles.identityBlock}>
          <Avatar name={profile?.name} size={80} />
          <Text style={styles.identityName}>{profile?.name}</Text>
          <Text style={styles.identityPhone}>{profile?.phone}</Text>
          {profile?.status === 'pending' && (
            <View style={{ marginTop: space[2] }}>
              <Chip label="Pending admin approval" tone="warn" icon="hourglass-outline" />
            </View>
          )}
        </View>

        {/* Details */}
        <View style={styles.section}>
          <SectionHeader title="Your details" />
          <Card>
            <Field label="Full name" value={name} onChangeText={setName} editable={isEditing} />
            <Field label="Phone" value={profile?.phone || ''} editable={false} />
            <Field label="City" value={profile?.city || 'Bangalore'} editable={false} />

            <Text style={styles.label}>Gender</Text>
            <Pressable
              onPress={() => openModal('gender')}
              disabled={!isEditing}
              style={[styles.select, !isEditing && styles.selectDisabled]}
            >
              <Text style={styles.selectText}>{gender || '—'}</Text>
              {isEditing && <Ionicons name="chevron-down" size={16} color={colors.inkFaint} />}
            </Pressable>

            <Text style={styles.label}>Occupation</Text>
            <Pressable
              onPress={() => openModal('occupation')}
              disabled={!isEditing}
              style={[styles.select, !isEditing && styles.selectDisabled]}
            >
              <Text style={styles.selectText}>{occupation || '—'}</Text>
              {isEditing && <Ionicons name="chevron-down" size={16} color={colors.inkFaint} />}
            </Pressable>

            {isEditing ? (
              <>
                <Text style={styles.label}>Location</Text>
                <Text style={styles.editHint}>
                  Pick again from the top, right down to your PG. Location
                  changes need super-admin approval before they take effect.
                </Text>
                <LocationPicker
                  initialChain={initialChain}
                  onChange={(picked) => setPickedLocation(picked)}
                />
              </>
            ) : (
              <>
                <Text style={styles.label}>Zone</Text>
                <View style={[styles.select, styles.selectDisabled]}>
                  <Text style={styles.selectText}>{zoneName || '—'}</Text>
                </View>
              </>
            )}

            {/* PG / hostel — visible in read mode too, not just while
                editing. This is the single most-asked-for line on the
                profile: "which PG am I registered under?" */}
            {!isEditing && (
              <>
                <Text style={styles.label}>PG or hostel</Text>
                <View style={[styles.select, styles.selectDisabled]}>
                  <Text style={styles.selectText}>{pgName || 'Not set'}</Text>
                </View>
                {locationTrail ? (
                  <View style={styles.trailRow}>
                    <Ionicons name="navigate-outline" size={13} color={colors.inkFaint} />
                    <Text style={styles.trailText}>{locationTrail}</Text>
                  </View>
                ) : null}
              </>
            )}

            {/* The PG step is part of the cascade above in edit mode, and
                rendered in the read-mode block — no separate picker needed. */}

            <Field label="Building / flat / landmark" value={address} onChangeText={setAddress} editable={isEditing} multiline />

            {isEditing && (
              <Button
                label="Submit changes for approval"
                onPress={handleSave}
                loading={saving}
                fullWidth
                style={{ marginTop: space[3] }}
              />
            )}
          </Card>
        </View>

        {/* Actions */}
        {!isEditing && (
          <View style={styles.section}>
            <Card padding={false}>
              <ActionRow icon="stats-chart-outline" label="Vote history"   color={colors.tealDark} onPress={() => router.push('/vote-history')} />
              <View style={styles.rowRule} />
              <ActionRow icon="chatbubble-outline"  label="Send feedback"  color={colors.teal}    onPress={() => router.push('/feedback')} />
              <View style={styles.rowRule} />
              <ActionRow icon="shield-outline"      label="Blocked people" color={colors.inkMuted} onPress={() => router.push('/blocked-users')} />
              <View style={styles.rowRule} />
              <ActionRow icon="log-out-outline"     label="Sign out"       color={colors.danger}  onPress={handleLogout} />
              {canDeleteAccount && (
                <>
                  <View style={styles.rowRule} />
                  <ActionRow icon="trash-outline"    label="Delete account" color={colors.danger}  onPress={handleDeleteAccount} loading={deleting} destructive />
                </>
              )}
            </Card>
          </View>
        )}
      </KeyboardAwareScroll>

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select {modalType}</Text>
            <FlatList
              data={modalOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    if (modalType === 'gender') setGender(item);
                    if (modalType === 'occupation') setOccupation(item);
                    setModalVisible(false);
                  }}
                  style={({ pressed }) => [styles.modalItem, pressed && { backgroundColor: colors.tealSoft }]}
                >
                  <Text style={styles.modalItemText}>{item.charAt(0).toUpperCase() + item.slice(1)}</Text>
                </Pressable>
              )}
            />
            <Button label="Cancel" onPress={() => setModalVisible(false)} variant="secondary" fullWidth style={{ marginTop: space[3] }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, editable, multiline }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <Input value={value} onChangeText={onChangeText} editable={editable} multiline={multiline} />
    </>
  );
}

function ActionRow({ icon, label, color, onPress, loading, destructive }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed, destructive && styles.actionRowDestructive]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.actionText, { color }]}>{loading ? 'Working…' : label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.inkGhost} style={{ marginLeft: 'auto' }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paperSoft },
  scroll: { paddingBottom: space[8] },

  headerAction: { ...type.body, color: colors.teal, fontWeight: '700' },

  identityBlock: { alignItems: 'center', paddingHorizontal: space[5], paddingTop: space[6], paddingBottom: space[4] },
  identityName:  { ...type.displayLg, marginTop: space[3] },
  identityPhone: { ...type.meta, marginTop: space[1] },

  section: { paddingHorizontal: space[4], paddingTop: space[4] },

  label: { ...type.meta, color: colors.inkMuted, fontWeight: '600', marginBottom: space[2], marginTop: space[3] },

  select: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ruleSoft,
    backgroundColor: colors.paper,
    paddingHorizontal: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectDisabled: { backgroundColor: colors.ruleFaint },
  selectText:     { ...type.body, color: colors.ink, textTransform: 'capitalize' },

  chipWrap: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },

  trailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space[2],
    paddingHorizontal: 2,
  },
  trailText: { ...type.micro, color: colors.inkFaint, flex: 1 },
  editHint:  { ...type.micro, color: colors.inkFaint, marginBottom: space[3], lineHeight: 16 },

  rowRule:    { height: 1, backgroundColor: colors.ruleFaint, marginLeft: space[4] + 20 + space[3] },
  actionRow:  { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3] },
  actionRowPressed: { backgroundColor: colors.tealSoft },
  actionRowDestructive: {},
  actionText: { ...type.bodyStrong },

  modalOverlay: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[5],
    maxHeight: '60%',
  },
  modalTitle:    { ...type.h2, marginBottom: space[3], textAlign: 'center', textTransform: 'capitalize' },
  modalItem:     { paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: colors.ruleFaint },
  modalItemText: { ...type.body, color: colors.ink },
});
