import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuthStore } from '../store/useAuthStore';
import { usersApi } from '../api/users';
import { locationsApi } from '../api/auth';

// -----------------------------------------------------------------------------
// Profile screen — real data from GET /api/users/me.
//
// Edits are submitted via POST /api/users/request-profile-edit and require
// super-admin approval before they land on the users row. The screen also
// lets the user hit "Delete Account" which soft-deletes their record and
// logs them out.
//
// Only fields the backend allow-lists as editable are exposed here:
//   name, gender, occupation, city, location_id, address
// Phone is the login identifier and stays read-only.
// -----------------------------------------------------------------------------
const OCCUPATIONS = ['student', 'employee', 'others'];
const GENDERS     = ['male', 'female'];

// Walk the eager-loaded location chain in memory.
const resolveChain = (location) => {
  const chain = [];
  let current = location;
  let hops = 0;
  while (current && hops < 10) {
    chain.push(current);
    current = current.parent || null;
    hops += 1;
  }
  return chain;
};

const zoneNameFromChain = (chain) => chain.find((c) => c.type === 'zone')?.name || null;

export default function ProfileScreen() {
  const router  = useRouter();
  const user    = useAuthStore((s) => s.user);
  const logout  = useAuthStore((s) => s.logout);

  const [loading,       setLoading]       = useState(true);
  const [profile,       setProfile]       = useState(null);   // full user object from /me
  const [zoneName,      setZoneName]      = useState(null);

  // Editable form state — reset from profile when it loads.
  const [isEditing, setIsEditing] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [name,       setName]       = useState('');
  const [gender,     setGender]     = useState('');
  const [occupation, setOccupation] = useState('');
  const [address,    setAddress]    = useState('');

  // Zone / address picker state (mirrors the register screen)
  const [zones,           setZones]           = useState([]);
  const [addresses,       setAddresses]       = useState([]);
  const [selectedZone,    setSelectedZone]    = useState(null);   // { id, name }
  const [selectedAddress, setSelectedAddress] = useState(null);   // { id, name } | null
  const [loadingZones,    setLoadingZones]    = useState(false);

  // Modal picker for gender/occupation
  const [modalType,    setModalType]    = useState(null);   // 'gender' | 'occupation'
  const [modalVisible, setModalVisible] = useState(false);

  // ---------------------------------------------------------------------------
  // Load profile from the server (source of truth) each time the screen
  // gets focus, so approvals show up without a manual refresh.
  // ---------------------------------------------------------------------------
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
        // If the user's leaf is an address row, seed selectedAddress with it.
        if (u.location && u.location.type === 'address') {
          setSelectedAddress({ id: u.location.id, name: u.location.name });
        } else {
          setSelectedAddress(null);
        }
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Could not load profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  // Load the zone list once we enter edit mode.
  useEffect(() => {
    if (!isEditing || zones.length > 0) return;
    (async () => {
      try {
        setLoadingZones(true);
        const res = await locationsApi.getLocations({ type: 'zone' });
        setZones(res.data || []);
      } catch (err) {
        Alert.alert('Error', 'Could not load zones');
      } finally {
        setLoadingZones(false);
      }
    })();
  }, [isEditing, zones.length]);

  const loadAddressesForZone = async (zoneId) => {
    try {
      const res = await locationsApi.getLocations({ type: 'address', parent_id: zoneId });
      setAddresses(res.data || []);
    } catch {
      setAddresses([]);
    }
  };

  const handleZonePick = async (z) => {
    setSelectedZone(z);
    setSelectedAddress(null);
    await loadAddressesForZone(z.id);
  };

  // ---------------------------------------------------------------------------
  // Submit an edit request. We only include fields that actually changed —
  // the backend allow-list will strip anything else.
  // ---------------------------------------------------------------------------
  const handleSave = async () => {
    if (!profile) return;

    const changes = {};
    if (name.trim() && name.trim() !== profile.name) changes.name = name.trim();
    if (gender && gender !== profile.gender) changes.gender = gender;
    if (occupation && occupation !== profile.occupation) changes.occupation = occupation;
    if (address.trim() && address.trim() !== profile.address) changes.address = address.trim();

    // Determine the intended location_id: address if the zone has addresses
    // and one is picked, else the zone itself.
    const intendedLocId = selectedAddress?.id || selectedZone?.id || null;
    if (intendedLocId && intendedLocId !== profile.location_id) {
      changes.location_id = intendedLocId;
    }

    if (Object.keys(changes).length === 0) {
      Alert.alert('No changes', 'You have not modified any fields.');
      return;
    }

    setSaving(true);
    try {
      await usersApi.requestProfileEdit(changes);
      Alert.alert(
        'Submitted',
        'Your changes have been sent to the super admin for review.'
      );
      setIsEditing(false);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to submit edit request');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This will permanently delete your account and anonymize your personal information. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => {
            // Second confirmation — Play/App Store guidelines strongly
            // recommend a two-step irreversible flow.
            Alert.alert(
              'Are you sure?',
              'Your poll history and donations will remain (for records) but your name, phone, and address will be permanently removed.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, delete forever',
                  style: 'destructive',
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      await usersApi.deleteMe();
                      await logout();
                      router.replace('/(auth)/login');
                    } catch (err) {
                      Alert.alert(
                        'Error',
                        err.response?.data?.message || 'Failed to delete account'
                      );
                    } finally {
                      setDeleting(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#0D9488" />
      </SafeAreaView>
    );
  }

  const openModal = (type) => {
    if (!isEditing) return;
    setModalType(type);
    setModalVisible(true);
  };

  const modalOptions = modalType === 'gender' ? GENDERS : OCCUPATIONS;

  const zoneHasAddresses = addresses.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Profile</Text>
        <TouchableOpacity
          onPress={() => {
            if (isEditing) loadProfile(); // discard changes
            setIsEditing((e) => !e);
          }}
        >
          <Text style={styles.editLink}>{isEditing ? 'Cancel' : 'Edit'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Avatar / header */}
        <View style={styles.avatarBox}>
          <Ionicons name="person-circle-outline" size={92} color="#0D9488" />
          <Text style={styles.nameDisplay}>{profile?.name || 'Resident'}</Text>
          <Text style={styles.phoneDisplay}>{profile?.phone}</Text>
          {profile?.status === 'pending' && (
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>Pending admin approval</Text>
            </View>
          )}
        </View>

        {/* Editable / read-only fields */}
        <View style={styles.card}>
          <Field
            label="Full Name"
            value={name}
            onChangeText={setName}
            editable={isEditing}
          />

          <Field
            label="Phone (cannot be changed)"
            value={profile?.phone || ''}
            editable={false}
          />

          <Field
            label="City"
            value={profile?.city || 'Bangalore'}
            editable={false}
          />

          {/* Gender */}
          <Text style={styles.fieldLabel}>Gender</Text>
          <TouchableOpacity
            style={[styles.selectBox, !isEditing && styles.disabled]}
            onPress={() => openModal('gender')}
            disabled={!isEditing}
          >
            <Text style={styles.selectText}>{gender || '—'}</Text>
            {isEditing && <Ionicons name="chevron-down" size={16} color="#64748B" />}
          </TouchableOpacity>

          {/* Occupation */}
          <Text style={styles.fieldLabel}>Occupation</Text>
          <TouchableOpacity
            style={[styles.selectBox, !isEditing && styles.disabled]}
            onPress={() => openModal('occupation')}
            disabled={!isEditing}
          >
            <Text style={styles.selectText}>{occupation || '—'}</Text>
            {isEditing && <Ionicons name="chevron-down" size={16} color="#64748B" />}
          </TouchableOpacity>

          {/* Zone */}
          <Text style={styles.fieldLabel}>Zone</Text>
          {isEditing ? (
            <>
              {loadingZones ? (
                <ActivityIndicator color="#0D9488" style={{ marginVertical: 6 }} />
              ) : (
                <View style={styles.zoneChips}>
                  {zones.map((z) => (
                    <TouchableOpacity
                      key={z.id}
                      style={[styles.zoneChip, selectedZone?.id === z.id && styles.zoneChipActive]}
                      onPress={() => handleZonePick(z)}
                    >
                      <Text
                        style={[
                          styles.zoneChipText,
                          selectedZone?.id === z.id && styles.zoneChipTextActive,
                        ]}
                      >
                        {z.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {/* Address picker — only if zone has addresses */}
              {zoneHasAddresses && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: 12 }]}>PG / Address</Text>
                  <View style={styles.zoneChips}>
                    {addresses.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.zoneChip, selectedAddress?.id === a.id && styles.zoneChipActive]}
                        onPress={() => setSelectedAddress(a)}
                      >
                        <Text
                          style={[
                            styles.zoneChipText,
                            selectedAddress?.id === a.id && styles.zoneChipTextActive,
                          ]}
                        >
                          {a.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </>
          ) : (
            <View style={[styles.selectBox, styles.disabled]}>
              <Text style={styles.selectText}>{zoneName || '—'}</Text>
            </View>
          )}

          {/* Address (free text) */}
          <Field
            label="Address (flat, block, landmark)"
            value={address}
            onChangeText={setAddress}
            editable={isEditing}
            multiline
          />

          {isEditing && (
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.disabledBtn]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.saveBtnText}>Submit for approval</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Quick actions */}
        {!isEditing && (
          <View style={styles.actionsCard}>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => router.push('/feedback')}
            >
              <Ionicons name="chatbubble-outline" size={20} color="#0D9488" />
              <Text style={styles.actionText}>Send feedback</Text>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionRow}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={20} color="#DC2626" />
              <Text style={[styles.actionText, { color: '#DC2626' }]}>Log out</Text>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionRow, styles.dangerRow]}
              onPress={handleDeleteAccount}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator color="#DC2626" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={20} color="#DC2626" />
                  <Text style={[styles.actionText, { color: '#DC2626', fontWeight: '700' }]}>
                    Delete account
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Gender / occupation modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Select {modalType === 'gender' ? 'Gender' : 'Occupation'}
            </Text>
            <FlatList
              data={modalOptions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => {
                    if (modalType === 'gender') setGender(item);
                    if (modalType === 'occupation') setOccupation(item);
                    setModalVisible(false);
                  }}
                >
                  <Text style={styles.modalItemText}>
                    {item.charAt(0).toUpperCase() + item.slice(1)}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// Small reusable field
// -----------------------------------------------------------------------------
function Field({ label, value, onChangeText, editable, multiline }) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          !editable && styles.disabled,
          multiline && { minHeight: 60, textAlignVertical: 'top' },
        ]}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        multiline={!!multiline}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#F8FAFC' },
  centered:   { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },
  backBtn:     { padding: 4 },
  editLink:    { color: '#0D9488', fontSize: 15, fontWeight: '700' },
  content:     { padding: 16, paddingBottom: 30 },

  avatarBox:      { alignItems: 'center', marginBottom: 20 },
  nameDisplay:    { fontSize: 22, fontWeight: '700', color: '#0F172A', marginTop: 6 },
  phoneDisplay:   { fontSize: 13, color: '#64748B', marginTop: 2 },
  statusBadge:    { marginTop: 8, backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  statusText:     { fontSize: 12, color: '#92400E', fontWeight: '600' },

  card: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
  },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0F172A',
  },
  disabled:      { backgroundColor: '#F1F5F9', color: '#64748B' },
  selectBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectText:    { fontSize: 15, color: '#0F172A', textTransform: 'capitalize' },

  zoneChips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  zoneChip:      { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#F1F5F9', borderRadius: 20 },
  zoneChipActive:{ backgroundColor: '#0D9488' },
  zoneChipText:  { fontSize: 12, fontWeight: '600', color: '#475569' },
  zoneChipTextActive: { color: '#FFF' },

  saveBtn: {
    backgroundColor: '#0D9488',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  disabledBtn:   { opacity: 0.6 },
  saveBtnText:   { color: '#FFF', fontSize: 15, fontWeight: '700' },

  actionsCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dangerRow:    { borderBottomWidth: 0, backgroundColor: '#FEF2F2' },
  actionText:   { fontSize: 15, color: '#0F172A', fontWeight: '500' },

  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent:  { backgroundColor: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '60%' },
  modalTitle:    { fontSize: 17, fontWeight: '700', color: '#1F2937', marginBottom: 12, textAlign: 'center' },
  modalItem:     { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalItemText: { fontSize: 16, color: '#334155' },
  modalClose:    { marginTop: 12, backgroundColor: '#E2E8F0', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalCloseText:{ fontSize: 15, fontWeight: '600', color: '#334155' },
});
