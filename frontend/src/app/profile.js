import React, { useState } from 'react';
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
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/useAuthStore'; 
import client from '../api/client'; 

// Data mapping rules based on your specifications
const ZONES_BY_REGION = {
  'South Bangalore': ['Girls Zone', 'Masjid Zone', 'Hostel', 'Stanza'],
  'North Bangalore': [],
  'East Bangalore': [],
  'West Bangalore': [],
};

const PGS_BY_ZONE = {
  'Stanza': [
    '888 7th Stage 11th Cross Road, Mylasandra Kings and Queens PG',
    'Stanza Living (Cordoba)', 'Target PG', 'RR Luxury PG',
    'Krishna Villa Apartments', 'Balaji PG for Gents', 'Lasya PG',
    'Shiva Sai PG', 'Stanza Living (Huelva House)', 'Global Vista',
    'SS Luxury PG', 'Good Lands PG', 'Millenial Blue Opal',
    'Paras Global Kutir', 'Others'
  ],
  'Girls Zone': [
    'Chaitrashree Comforts', 'Chiguru PG for ladies', 'Global Residency', 
    'Global Vista Apartment', 'Goodlands luxury ladies PG', 'habitat illuminar', 
    'JV Queens PG', 'JV Queens Prime PG', 'Krishna Global Villaments', 
    'New SL Ladies PG', 'RVCE girls DJ hostel', 'RVCE girls krishna garden hostel', 
    'Sai Ram luxury PG for ladies', 'Samruddhi PG for ladies', 
    'SL grand luxury ladies PG', 'SL prime PG for ladies', 'SLN grand', 
    'Sri Ladies PG', 'Sri Sai Durga ladies PG', 'Sri vengamamba PG', 
    'SS Home stay', 'SSR PG for ladies', 'Stanza Living Granada House', 
    'Stanza Living Nome House', 'Stay Luxe Inn', 'The Millenial Topaz 1', 
    'The Millenial Topaz 2', 'Others'
  ],
  'Masjid Zone': [
    'Maruti pg', 'Flat infront of masjid', 'Malanad apartments', 
    'Dupasipallya musalla', 'RK pal pg', 'Others'
  ],
  'Hostel': [
    'Krishna Hostel', 'Cauvery Hostel', 'MV hostel', 'Others'
  ]
};

const OCCUPATION_OPTIONS = ['Student', 'Employee', 'Others'];
const REGION_OPTIONS = ['South Bangalore', 'North Bangalore', 'East Bangalore', 'West Bangalore'];

export default function ProfileScreen() {
  const router = useRouter();
  
  const user = useAuthStore((state) => state.user) || {
    name: 'Resident',
    email: 'resident@example.com',
    phone: '+91 9876543210',
    region: 'South Bangalore',
    zone: 'Girls Zone',
    pg: 'Global Vista Apartment',
    occupation: 'Student'
  };
  const logout = useAuthStore((state) => state.logout);

  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState(user.approvalStatus || 'Approved'); // 'Pending for Approval'

  // Form states
  const [name, setName] = useState(user.name || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [region, setRegion] = useState(user.region || 'South Bangalore');
  const [zone, setZone] = useState(user.zone || 'Girls Zone');
  const [pg, setPg] = useState(user.pg || '');
  const [customPg, setCustomPg] = useState('');
  
  const [occupation, setOccupation] = useState(user.occupation || 'Student');
  const [customOccupation, setCustomOccupation] = useState('');

  // Modal selector states
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState(''); // 'region', 'zone', 'pg', 'occupation'

  // Cascading logic handlers
  const handleSelectRegion = (selectedRegion) => {
    setRegion(selectedRegion);
    // Reset zone and pg when region changes
    const availableZones = ZONES_BY_REGION[selectedRegion] || [];
    setZone(availableZones[0] || '');
    setPg('');
    setModalVisible(false);
  };

  const handleSelectZone = (selectedZone) => {
    setZone(selectedZone);
    setPg(''); // Reset PG when zone changes
    setModalVisible(false);
  };

  const openSelectionModal = (type) => {
    if (!isEditing) return;
    setModalType(type);
    setModalVisible(true);
  };

  const getModalData = () => {
    if (modalType === 'region') return REGION_OPTIONS;
    if (modalType === 'zone') return ZONES_BY_REGION[region] || [];
    if (modalType === 'pg') return PGS_BY_ZONE[zone] || [];
    if (modalType === 'occupation') return OCCUPATION_OPTIONS;
    return [];
  };

  const handleModalItemSelect = (item) => {
    if (modalType === 'region') handleSelectRegion(item);
    else if (modalType === 'zone') handleSelectZone(item);
    else if (modalType === 'pg') {
      setPg(item);
      setModalVisible(false);
    } else if (modalType === 'occupation') {
      setOccupation(item);
      setModalVisible(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setLoading(true);
      const finalPg = pg === 'Others' ? customPg : pg;
      const finalOccupation = occupation === 'Others' ? customOccupation : occupation;

      // API request to backend
      await client.put('/user/profile', {
        name,
        phone,
        region,
        zone,
        pg: finalPg,
        occupation: finalOccupation,
      });

      setApprovalStatus('Pending for Approval');
      Alert.alert('Submitted', 'Profile update sent for Super Admin approval.');
      setIsEditing(false);
    } catch (error) {
      // @ts-ignore
      Alert.alert('Error', error.response?.data?.message || 'Failed to update profile.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Logout', 
        style: 'destructive', 
        onPress: () => {
          logout();
          router.replace('/(auth)/login'); 
        } 
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Profile</Text>
        <TouchableOpacity onPress={() => setIsEditing(!isEditing)}>
          <Text style={styles.editText}>{isEditing ? 'Cancel' : 'Edit'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Avatar & Status Banner */}
        <View style={styles.avatarContainer}>
          <Ionicons name="person-circle-outline" size={90} color="#0D9488" />
          <Text style={styles.nameDisplay}>{name}</Text>
          <Text style={styles.emailText}>{user.email}</Text>
          
          {approvalStatus === 'Pending for Approval' && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingText}>⚠️ Pending for Super Admin Approval</Text>
            </View>
          )}
        </View>

        {/* Details Card */}
        <View style={styles.card}>
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.disabledInput]}
              value={name}
              onChangeText={setName}
              editable={isEditing}
            />
          </View>
        

          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              style={[styles.input, !isEditing && styles.disabledInput]}
              value={phone}
              onChangeText={setPhone}
              editable={isEditing}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.fieldContainer}>
            <Text style={styles.label}>City (Fixed)</Text>
            <TextInput
              style={[styles.input, styles.disabledInput]}
              value="Bangalore"
              editable={false}
            />
          </View>

          {/* Region Selection */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Region</Text>
            <TouchableOpacity 
              style={[styles.input, !isEditing && styles.disabledInput, styles.selectorBox]} 
              onPress={() => openSelectionModal('region')}
              disabled={!isEditing}
            >
              <Text style={styles.selectorText}>{region}</Text>
              {isEditing && <Ionicons name="chevron-down" size={18} color="#666" />}
            </TouchableOpacity>
          </View>

          {/* Zone Selection */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Zone</Text>
            <TouchableOpacity 
              style={[styles.input, !isEditing && styles.disabledInput, styles.selectorBox]} 
              onPress={() => openSelectionModal('zone')}
              disabled={!isEditing || ZONES_BY_REGION[region]?.length === 0}
            >
              <Text style={styles.selectorText}>{zone || 'Select Zone'}</Text>
              {isEditing && <Ionicons name="chevron-down" size={18} color="#666" />}
            </TouchableOpacity>
          </View>

          {/* PG / Hostel Selection */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>PG / Hostel</Text>
            <TouchableOpacity 
              style={[styles.input, !isEditing && styles.disabledInput, styles.selectorBox]} 
              onPress={() => openSelectionModal('pg')}
              disabled={!isEditing || !zone}
            >
              <Text style={styles.selectorText} numberOfLines={1}>{pg || 'Select PG / Hostel'}</Text>
              {isEditing && <Ionicons name="chevron-down" size={18} color="#666" />}
            </TouchableOpacity>
          </View>

          {/* Custom PG Input if "Others" selected */}
          {isEditing && pg === 'Others' && (
            <View style={styles.fieldContainer}>
              <Text style={styles.label}>Enter Custom PG Name</Text>
              <TextInput
                style={styles.input}
                value={customPg}
                onChangeText={setCustomPg}
                placeholder="Type your PG name"
              />
            </View>
          )}

          {/* Occupation Selection */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Occupation</Text>
            <TouchableOpacity 
              style={[styles.input, !isEditing && styles.disabledInput, styles.selectorBox]} 
              onPress={() => openSelectionModal('occupation')}
              disabled={!isEditing}
            >
              <Text style={styles.selectorText}>{occupation}</Text>
              {isEditing && <Ionicons name="chevron-down" size={18} color="#666" />}
            </TouchableOpacity>
          </View>

          {/* Custom Occupation Input if "Others" selected */}
          {isEditing && occupation === 'Others' && (
            <View style={styles.fieldContainer}>
              <Text style={styles.label}>Specify Occupation</Text>
              <TextInput
                style={styles.input}
                value={customOccupation}
                onChangeText={setCustomOccupation}
                placeholder="Type occupation"
              />
            </View>
          )}

          {/* Save Button */}
          {isEditing && (
            <TouchableOpacity 
              style={styles.saveButton} 
              onPress={handleSaveProfile}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Submit for Approval</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Log Out Button */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#EF4444" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Selection Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select {modalType.toUpperCase()}</Text>
            <FlatList
              data={getModalData()}
              keyExtractor={(item, index) => index.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.modalItem} 
                  onPress={() => handleModalItemSelect(item)}
                >
                  <Text style={styles.modalItemText}>{item}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity 
              style={styles.modalCloseButton} 
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  backButton: { padding: 4 },
  editText: { fontSize: 16, color: '#0D9488', fontWeight: '600' },
  content: { padding: 20 },
  avatarContainer: { alignItems: 'center', marginBottom: 20 },
  nameDisplay: { fontSize: 22, fontWeight: 'bold', color: '#1F2937', marginTop: 8 },
  emailText: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  pendingBadge: { backgroundColor: '#FEF3C7', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, marginTop: 8 },
  pendingText: { color: '#D97706', fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  fieldContainer: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#4B5563', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#1F2937', backgroundColor: '#fff' },
  disabledInput: { backgroundColor: '#F3F4F6', color: '#6B7280', borderColor: '#E5E7EB' },
  selectorBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectorText: { fontSize: 16, color: '#1F2937' },
  saveButton: { backgroundColor: '#0D9488', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  logoutButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', paddingVertical: 14, borderRadius: 8, justifyContent: 'center' },
  logoutText: { color: '#EF4444', fontSize: 16, fontWeight: '600', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '60%', padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 16, textAlign: 'center', color: '#1F2937' },
  modalItem: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  modalItemText: { fontSize: 16, color: '#374151' },
  modalCloseButton: { marginTop: 16, backgroundColor: '#E5E7EB', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalCloseText: { fontSize: 16, fontWeight: '600', color: '#374151' }
});