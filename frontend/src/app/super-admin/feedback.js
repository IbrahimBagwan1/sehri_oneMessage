import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  Alert 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const ZONES = ['Stanza', 'Masjid Zone', 'Girls Zone', 'Hostel'];

export default function SuperAdminUsersScreen() {
  const router = useRouter();

  // Mock users data categorized by zone with approval status and roles
  const [zoneUsers, setZoneUsers] = useState({
    'Stanza': [
      { id: '1', name: 'Mohammed Asim', phone: '+91 9876543210', status: 'Pending', role: 'User' },
      { id: '2', name: 'Rahul Sharma', phone: '+91 9123456789', status: 'Approved', role: 'Admin' }
    ],
    'Masjid Zone': [],
    'Girls Zone': [
      { id: '3', name: 'Ayesha', phone: '+91 9988776655', status: 'Pending', role: 'User' }
    ],
    'Hostel': []
  });

  // Handle user approval workflow
  const handleApproveUser = (zone, id) => {
    setZoneUsers(prev => ({
      ...prev,
      [zone]: prev[zone].map(user => 
        user.id === id ? { ...user, status: 'Approved' } : user
      )
    }));
    Alert.alert('Success', 'User has been approved.');
  };

  // Handle appointing a user as a Zone Admin
  const handleAppointAdmin = (zone, id, name) => {
    Alert.alert(
      'Assign Admin', 
      `Are you sure you want to appoint ${name} as the Admin for ${zone}?`, 
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Appoint', 
          onPress: () => {
            setZoneUsers(prev => ({
              ...prev,
              [zone]: prev[zone].map(user => 
                user.id === id ? { ...user, role: 'Admin' } : user
              )
            }));
            Alert.alert('Success', `${name} is now the Admin for ${zone}.`);
          } 
        }
      ]
    );
  };

  // Handle navigating to private chat with a specific user
  const handlePrivateChat = (user) => {
    // Navigate to chat screen passing user details as query params
    router.push({
      pathname: '/super-admin/chat',
      params: { recipientId: user.id, recipientName: user.name }
    });
  };

  // Handle deleting a user entry
  const handleDeleteUser = (zone, id) => {
    Alert.alert('Delete User', 'Are you sure you want to remove this user?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive', 
        onPress: () => {
          setZoneUsers(prev => ({
            ...prev,
            [zone]: prev[zone].filter(user => user.id !== id)
          }));
        }
      }
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Zone-wise Users & Approvals</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {ZONES.map(zone => {
          const users = zoneUsers[zone] || [];
          return (
            <View key={zone} style={styles.zoneCard}>
              <View style={styles.zoneHeaderRow}>
                <Text style={styles.zoneTitle}>{zone}</Text>
                <Text style={styles.countBadge}>{users.length} Users</Text>
              </View>

              {users.length > 0 ? (
                users.map(user => (
                  <View key={user.id} style={styles.userRow}>
                    <View style={styles.userInfo}>
                      <View style={styles.rowInline}>
                        <Text style={styles.userName}>{user.name}</Text>
                        <Text style={[styles.roleTag, user.role === 'Admin' ? styles.adminTag : styles.userTag]}>
                          {user.role}
                        </Text>
                      </View>
                      <Text style={styles.userPhone}>{user.phone}</Text>
                      <Text style={[styles.statusText, user.status === 'Approved' ? styles.approvedText : styles.pendingText]}>
                        Status: {user.status}
                      </Text>
                    </View>

                    {/* Action Buttons */}
                    <View style={styles.actionsContainer}>
                      {user.status === 'Pending' && (
                        <TouchableOpacity style={styles.approveBtn} onPress={() => handleApproveUser(zone, user.id)}>
                          <Text style={styles.btnText}>Approve</Text>
                        </TouchableOpacity>
                      )}

                      {user.role !== 'Admin' && user.status === 'Approved' && (
                        <TouchableOpacity style={styles.appointBtn} onPress={() => handleAppointAdmin(zone, user.id, user.name)}>
                          <Text style={styles.btnText}>Make Admin</Text>
                        </TouchableOpacity>
                      )}

                      <TouchableOpacity style={styles.chatIconBtn} onPress={() => handlePrivateChat(user)}>
                        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#0D9488" />
                      </TouchableOpacity>

                      <TouchableOpacity style={styles.deleteIconBtn} onPress={() => handleDeleteUser(zone, user.id)}>
                        <Ionicons name="trash-outline" size={18} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>No users in this zone.</Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  backButton: { padding: 4 },
  content: { padding: 16 },
  zoneCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  zoneHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 8, marginBottom: 12 },
  zoneTitle: { fontSize: 16, fontWeight: 'bold', color: '#0D9488' },
  countBadge: { fontSize: 12, backgroundColor: '#F3F4F6', color: '#4B5563', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  userRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  userInfo: { flex: 1 },
  rowInline: { flexDirection: 'row', alignItems: 'center' },
  userName: { fontSize: 15, fontWeight: '600', color: '#1F2937', marginRight: 8 },
  roleTag: { fontSize: 10, fontWeight: 'bold', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  userTag: { backgroundColor: '#E5E7EB', color: '#374151' },
  adminTag: { backgroundColor: '#CCFBF1', color: '#0F766E' },
  userPhone: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  statusText: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  approvedText: { color: '#059669' },
  pendingText: { color: '#D97706' },
  actionsContainer: { flexDirection: 'row', alignItems: 'center' },
  approveBtn: { backgroundColor: '#0D9488', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, marginRight: 6 },
  appointBtn: { backgroundColor: '#2563EB', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, marginRight: 6 },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  chatIconBtn: { padding: 6, backgroundColor: '#F0FDFA', borderRadius: 6, marginRight: 6 },
  deleteIconBtn: { padding: 6, backgroundColor: '#FEF2F2', borderRadius: 6 },
  emptyText: { fontSize: 13, color: '#9CA3AF', fontStyle: 'italic', paddingVertical: 6, textAlign: 'center' }
});