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

export default function SuperAdminDonationsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [donationsList, setDonationsList] = useState([]);

  // Fetch donations from backend on load (with fallback mock data for testing)
  useEffect(() => {
    fetchDonations();
  }, []);

  const fetchDonations = async () => {
    try {
      setLoading(true);
      // Replace with your actual backend endpoint
       const response = await client.get('/super-admin/donations');
      setDonationsList(response.data);

      // Temporary mock data matching your exact requirements
      setDonationsList([
        {
          id: '1',
          donorName: 'Mohammed Asim',
          zone: 'Stanza',
          pgName: 'Stanza Living (Cordoba)',
          amount: '₹1,500',
          timestamp: '02 Sep 2026, 05:30 PM'
        },
        {
          id: '2',
          donorName: 'Rahul Sharma',
          zone: 'Masjid Zone',
          pgName: 'Green Valley PG',
          amount: '₹500',
          timestamp: '01 Sep 2026, 02:10 PM'
        }
      ]);
    } catch (_error) {
      Alert.alert('Error', 'Failed to load donation history.');
    } finally {
      setLoading(false);
    }
  };

  // Delete a single donation record
  const handleDeleteItem = (id) => {
    Alert.alert('Delete Record', 'Are you sure you want to remove this donation record?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive', 
        onPress: () => {
          setDonationsList(prev => prev.filter(item => item.id !== id));
        }
      }
    ]);
  };

  // Clear all donation history
  const handleClearAll = () => {
    Alert.alert('Clear History', 'Are you sure you want to delete all donation records?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Clear All', 
        style: 'destructive', 
        onPress: () => setDonationsList([])
      }
    ]);
  };

  // Calculate total donations collected
  const totalAmount = donationsList.reduce((sum, item) => {
    const numericVal = parseInt(item.amount.replace(/[^0-9]/g, ''), 10) || 0;
    return sum + numericVal;
  }, 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Donations History</Text>
        {donationsList.length > 0 ? (
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={styles.clearText}>Clear All</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Total Summary Banner */}
        {!loading && donationsList.length > 0 && (
          <View style={styles.summaryBanner}>
            <View>
              <Text style={styles.summaryLabel}>Total Collections</Text>
              <Text style={styles.summaryAmount}>₹{totalAmount.toLocaleString('en-IN')}</Text>
            </View>
            <Ionicons name="wallet-outline" size={28} color="#0D9488" />
          </View>
        )}

        {loading ? (
          <ActivityIndicator size="large" color="#0D9488" style={{ marginTop: 40 }} />
        ) : donationsList.length > 0 ? (
          donationsList.map(item => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.donorName}>{item.donorName}</Text>
                  <Text style={styles.locationText}>
                    {item.pgName} • <Text style={styles.zoneHighlight}>{item.zone}</Text>
                  </Text>
                </View>
                <View style={styles.amountBadge}>
                  <Text style={styles.amountText}>{item.amount}</Text>
                </View>
                <TouchableOpacity onPress={() => handleDeleteItem(item.id)} style={styles.deleteIcon}>
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </TouchableOpacity>
              </View>

              <View style={styles.footerRow}>
                <Text style={styles.timestampText}>Paid on: {item.timestamp}</Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="card-outline" size={48} color="#9CA3AF" />
            <Text style={styles.emptyText}>No donation records available.</Text>
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
  clearText: { color: '#EF4444', fontWeight: '600', fontSize: 14 },
  content: { padding: 16 },
  summaryBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F0FDFA', borderWidth: 1, borderColor: '#CCFBF1', borderRadius: 12, padding: 16, marginBottom: 16 },
  summaryLabel: { fontSize: 12, color: '#0F766E', fontWeight: '600', textTransform: 'uppercase' },
  summaryAmount: { fontSize: 22, fontWeight: 'bold', color: '#0D9488', marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 3, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F3F4F6', paddingBottom: 10, marginBottom: 8 },
  donorName: { fontSize: 16, fontWeight: 'bold', color: '#1F2937' },
  locationText: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  zoneHighlight: { color: '#0D9488', fontWeight: '600' },
  amountBadge: { backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginRight: 8 },
  amountText: { color: '#059669', fontWeight: 'bold', fontSize: 14 },
  deleteIcon: { padding: 4 },
  footerRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  timestampText: { fontSize: 11, color: '#9CA3AF' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyText: { fontSize: 14, color: '#9CA3AF', fontStyle: 'italic', marginTop: 8 }
});