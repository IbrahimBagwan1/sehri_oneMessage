import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ScrollView,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../store/useAuthStore';
import { usersApi } from '../api/users';
import { locationsApi } from '../api/auth';
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
  const router  = useRouter();
  const user    = useAuthStore((s) => s.user);
  const logout  = useAuthStore((s) => s.logout);

  const [loading, setLoading]     = useState(true);
  const [profile, setProfile]     = useState(null);
  const [zoneName, setZoneName]   = useState(null);

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);

  const [name, setName]           = useState('');
  const [gender, setGender]       = useState('');
  const [occupation, setOccupation] = useState('');
  const [address, setAddress]     = useState('');

  const [zones, setZones]                     = useState([]);
  const [addresses, setAddresses]             = useState([]);
  const [selectedZone, setSelectedZone]       = useState(null);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [loadingZones, setLoadingZones]       = useState(false);

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
        const zone  = chain.find((c) => c.type === 'zone');
        setSelectedZone(zone ? { id: zone.id, name: zone.name } : null);
        setSelectedAddress(u.location?.type === 'address' ? { id: u.location.id, name: u.location.name } : null);
      }
    } catch (err) {
      Alert.alert("Couldn't load profile", err?.response?.data?.message || 'Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  useEffect(() => {
    if (!isEditing || zones.length > 0) return;
    (async () => {
      try {
        setLoadingZones(true);
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch {
        Alert.alert("Couldn't load zones", 'Try again in a moment.');
      } finally {
        setLoadingZones(false);
      }
    })();
  }, [isEditing, zones.length]);

  const loadAddressesForZone = async (zoneId) => {
    try {
      const res = await locationsApi.getLocations({ type: 'address', parent_id: zoneId });
      setAddresses(res.data || []);
    } catch { setAddresses([]); }
  };

  const handleZonePick = async (z) => {
    setSelectedZone(z);
    setSelectedAddress(null);
    await loadAddressesForZone(z.id);
  };

  const handleSave = async () => {
    if (!profile) return;
    const changes = {};
    if (name.trim() && name.trim() !== profile.name) changes.name = name.trim();
    if (gender && gender !== profile.gender) changes.gender = gender;
    if (occupation && occupation !== profile.occupation) changes.occupation = occupation;
    if (address.trim() && address.trim() !== profile.address) changes.address = address.trim();
    const intendedLoc = selectedAddress?.id || selectedZone?.id;
    if (intendedLoc && intendedLoc !== profile.location_id) changes.location_id = intendedLoc;

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
      'This anonymizes your personal information and prevents sign-in. Your poll history and donations stay for community records but your name, phone, and address are permanently removed.',
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
  const zoneHasAddresses = addresses.length > 0;

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

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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

            <Text style={styles.label}>Zone</Text>
            {isEditing ? (
              loadingZones ? (
                <LoadingState message="Loading zones…" compact />
              ) : (
                <View style={styles.chipWrap}>
                  {zones.map((z) => (
                    <Chip
                      key={z.id}
                      label={z.name}
                      tone={selectedZone?.id === z.id ? 'teal' : 'neutral'}
                      selected={selectedZone?.id === z.id}
                      onPress={() => handleZonePick(z)}
                    />
                  ))}
                </View>
              )
            ) : (
              <View style={[styles.select, styles.selectDisabled]}>
                <Text style={styles.selectText}>{zoneName || '—'}</Text>
              </View>
            )}

            {isEditing && zoneHasAddresses && (
              <>
                <Text style={styles.label}>PG or address</Text>
                <View style={styles.chipWrap}>
                  {addresses.map((a) => (
                    <Chip
                      key={a.id}
                      label={a.name}
                      tone={selectedAddress?.id === a.id ? 'teal' : 'neutral'}
                      selected={selectedAddress?.id === a.id}
                      onPress={() => setSelectedAddress(a)}
                    />
                  ))}
                </View>
              </>
            )}

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
              <ActionRow icon="chatbubble-outline"  label="Send feedback"  color={colors.teal}    onPress={() => router.push('/feedback')} />
              <View style={styles.rowRule} />
              <ActionRow icon="log-out-outline"     label="Sign out"       color={colors.danger}  onPress={handleLogout} />
              <View style={styles.rowRule} />
              <ActionRow icon="trash-outline"       label="Delete account" color={colors.danger}  onPress={handleDeleteAccount} loading={deleting} destructive />
            </Card>
          </View>
        )}
      </ScrollView>

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
