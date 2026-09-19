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

export default function SuperAdminRequestsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [requestsList, setRequestsList] = useState([]);

  // Fetch requests from backend on load
  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      // Replace with your actual backend endpoint
       const response = await client.get('/admin/requests');
       setRequestsList(response.data);

      // Temporary mock data matching your exact requirements
      setRequestsList([
        {
          id: '1',
          userName: 'Mohammed Asim',
          zone: 'Stanza',
          requestType: 'User Registration Approval',
          timestamp: '03 Sep 2026, 10:15 AM'
        },
        {
          id: '2',
          userName: 'Rahul Sharma',
          zone: 'Masjid Zone',
          requestType: 'Profile Heading Update',
          timestamp: '02 Sep 2026, 04:45 PM'
        },
        {
          id: '3',
          userName: 'Ayesha',
          zone: 'Girls Zone',
          requestType: 'Admin Privileges Request',
          timestamp: '02 Sep 2026, 01-20 PM'
        }
      ]);
    } catch (_error) {
      Alert.alert('Error', 'Failed to load requests.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Approve or Reject action
  const handleAction = async (id, actionType, userName) => {
    try {
      // Call backend to process the approval/rejection and notify the user
      // await client.post(`/admin/requests/${id}/action`, { status: actionType });

      // Update local UI state by removing the handled request
      setRequestsList(prev => prev.filter(item => item.id !== id));
      
      Alert.alert(
        'Success', 
        `Request for ${userName} has been ${actionType === 'approve' ? 'approved' : 'rejected'}. Notification sent to user.`
      );
    } catch (_error) {
      Alert.alert('Error', `Failed to ${actionType} the request.`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Requests Approval</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color="#0D9488" style={{ marginTop: 40 }} />
        ) : requestsList.length > 0 ? (
          requestsList.map(item => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{item.userName}</Text>
                  <Text style={styles.locationText}>
                    Zone: <Text style={styles.zoneHighlight}>{item.zone}</Text>
                  </Text>
                </View>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeText}>{item.requestType}</Text>
                </View>
              </View>

              <View style={styles.footerRow}>
                <Text style={styles.timestampText}>{item.timestamp}</Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.buttonContainer}>
                <TouchableOpacity 
                  style={styles.rejectBtn} 
                  onPress={() => handleAction(item.id, 'reject', item.userName)}
                >
                  <Ionicons name="close-circle-outline" size={18} color="#EF4444" style={{ marginRight: 4 }} />
                  <Text style={styles.rejectText}>Reject</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.approveBtn} 
                  onPress={() => handleAction(item.id, 'approve', item.userName)}
                >
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={styles.approveText}>Approve</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="checkbox-outline" size={48} color="#9CA3AF" />
            <Text style={styles.emptyText}>No pending requests.</Text>
          </View>
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
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 10, marginBottom: 8 },
  userName: { fontSize: 16, fontWeight: 'bold', color: '#1F2937' },
  locationText: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  zoneHighlight: { color: '#0D9488', fontWeight: '600' },
  typeBadge: { backgroundColor: '#F0FDFA', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#CCFBF1' },
  typeText: { color: '#0F766E', fontSize: 11, fontWeight: '600' },
  footerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 },
  timestampText: { fontSize: 11, color: '#9CA3AF' },
  buttonContainer: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  rejectBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#FEF2F2', paddingVertical: 10, borderRadius: 8, marginRight: 6, borderWidth: 1, borderColor: '#FEE2E2' },
  rejectText: { color: '#EF4444', fontWeight: 'bold', fontSize: 13 },
  approveBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D9488', paddingVertical: 10, borderRadius: 8, marginLeft: 6 },
  approveText: { color: '#fff', fontWeight: 'bold', fontSize: 13 }
});