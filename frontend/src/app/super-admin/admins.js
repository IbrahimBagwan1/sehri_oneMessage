import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import client from '../../api/client'; // Your Axios client

const ZONES = ['Stanza', 'Masjid Zone', 'Girls Zone', 'Hostel'];

export default function SuperAdminAdminsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // State storing admins grouped by zone with their activity logs
  const [zoneAdmins, setZoneAdmins] = useState({
    'Stanza': [
      { id: '101', name: 'Rahul Sharma', phone: '+91 9123456789', lastActive: 'Today, 06:15 PM', actionsCount: 14 }
    ],
    'Masjid Zone': [],
    'Girls Zone': [
      { id: '102', name: 'Fatima Zahra', phone: '+91 9811223344', lastActive: 'Yesterday, 08:30 PM', actionsCount: 8 }
    ],
    'Hostel': []
  });

  useEffect(() => {
    fetchAdminsData();
  }, []);

  const fetchAdminsData = async () => {
    try {
      setLoading(true);
      // Replace with your actual backend endpoint e.g., client.get('/admin/zone-admins')
      // const response = await client.get('/admin/zone-admins');
      // setZoneAdmins(response.data);
      setLoading(false);
    } catch (_error) {
      setLoading(false);
      Alert.alert('Error', 'Failed to load zone admins.');
    }
  };

  // Revoke Admin Privileges
  const handleRevokeAdmin = (zone, adminId, adminName) => {
    Alert.alert(
      'Revoke Admin', 
      `Are you sure you want to remove ${adminName} as Admin for ${zone}?`, 
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Revoke', 
          style: 'destructive', 
          onPress: async () => {
            try {
              // await client.post(`/admin/revoke-admin`, { userId: adminId, zone });
              setZoneAdmins(prev => ({
                ...prev,
                [zone]: prev[zone].filter(admin => admin.id !== adminId)
              }));
              Alert.alert('Success', `${adminName}'s admin privileges have been revoked.`);
            } catch (_error) {
              Alert.alert('Error', 'Failed to revoke admin privileges.');
            }
          } 
        }
      ]
    );
  };

  // View Detailed Activity Log for an Admin
  const handleViewActivity = (admin) => {
    Alert.alert(
      `Activity Log: ${admin.name}`, 
      `Zone: ${admin.name}\nTotal Actions Logged: ${admin.actionsCount}\nLast Active: ${admin.lastActive}\n\n• Approved zone registrations\n• Moderated community messages\n• Updated schedule records`,
      [{ text: 'Close' }]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Zone Admins</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color="#0D9488" style={{ marginTop: 40 }} />
        ) : (
          ZONES.map(zone => {
            const admins = zoneAdmins[zone] || [];
            return (
              <View key={zone} style={styles.zoneCard}>
                <View style={styles.zoneHeaderRow}>
                  <Text style={styles.zoneTitle}>{zone}</Text>
                  <Text style={styles.countBadge}>{admins.length} Admin{admins.length === 1 ? '' : 's'}</Text>
                </View>

                {admins.length > 0 ? (
                  admins.map(admin => (
                    <View key={admin.id} style={styles.adminRow}>
                      <View style={styles.adminInfo}>
                        <View style={styles.rowInline}>
                          <Text style={styles.adminName}>{admin.name}</Text>
                          <View style={styles.adminTag}>
                            <Text style={styles.adminTagText}>Zone Admin</Text>
                          </View>
                        </View>
                        <Text style={styles.adminPhone}>{admin.phone}</Text>
                        <Text style={styles.activityText}>Last Active: {admin.lastActive} ({admin.actionsCount} actions)</Text>
                      </View>

                      {/* Action Buttons */}
                      <View style={styles.actionsContainer}>
                        <TouchableOpacity 
                          style={styles.activityBtn} 
                          onPress={() => handleViewActivity(admin)}
                        >
                          <Ionicons name="eye-outline" size={18} color="#2563EB" />
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={styles.revokeBtn} 
                          onPress={() => handleRevokeAdmin(zone, admin.id, admin.name)}
                        >
                          <Ionicons name="shield-disclaimer-outline" size={18} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No admin assigned for this zone yet.</Text>
                )}
              </View>
            );
          })
        )}
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
  countBadge: { fontSize: 12, backgroundColor: '#F0FDFA', color: '#0F766E', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', fontWeight: '600' },
  adminRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F9FAFB' },
  adminInfo: { flex: 1 },
  rowInline: { flexDirection: 'row', alignItems: 'center' },
  adminName: { fontSize: 15, fontWeight: '600', color: '#1F2937', marginRight: 8 },
  adminTag: { backgroundColor: '#CCFBF1', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  adminTagText: { fontSize: 10, fontWeight: 'bold', color: '#0F766E' },
  adminPhone: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  activityText: { fontSize: 11, color: '#059669', marginTop: 3, fontWeight: '500' },
  actionsContainer: { flexDirection: 'row', alignItems: 'center' },
  activityBtn: { padding: 8, backgroundColor: '#EFF6FF', borderRadius: 6, marginRight: 6 },
  revokeBtn: { padding: 8, backgroundColor: '#FEF2F2', borderRadius: 6 },
  emptyText: { fontSize: 13, color: '#9CA3AF', fontStyle: 'italic', paddingVertical: 6, textAlign: 'center' }
});