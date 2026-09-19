import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/useAuthStore';

export default function AdminDashboard() {
  const router          = useRouter();
  const switchRole      = useAuthStore((state) => state.switchRole);
  const available_roles = useAuthStore((state) => state.available_roles);

  const handleSwitchToUser = async () => {
    try {
      await switchRole('user');
      router.replace('/(user)');
    } catch (err) {
      Alert.alert('Switch Failed', err.response?.data?.message || 'Could not switch role.');
    }
  };

  // List of all Super Admin buttons and their navigation routes
  const menuItems = [
    { title: 'Users & Zone Classification', icon: 'people', route: '/super-admin/users' },
    { title: 'Requests Approval', icon: 'checkbox', route: '/super-admin/requests' },
    { title: 'Donations History', icon: 'card', route: '/super-admin/donations' },
    { title: 'User Feedback', icon: 'chatbubbles', route: '/super-admin/feedback' },
    { title: 'Poll History', icon: 'bar-chart', route: '/super-admin/polls' },
    { title: 'Manage Zone Admins', icon: 'shield-checkmark', route: '/super-admin/admins' },
    { title: 'Chatbox & Broadcast', icon: 'paper-plane', route: '/super-admin/chat' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Super Admin Dashboard</Text>
        {available_roles.includes('user') && (
          <TouchableOpacity style={styles.switchBtn} onPress={handleSwitchToUser}>
            <Ionicons name="person-outline" size={14} color="#0369A1" />
            <Text style={styles.switchBtnText}>User</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {menuItems.map((item, index) => (
          <TouchableOpacity 
            key={index} 
            style={styles.card} 
            onPress={() => router.push(item.route)}
          >
            <Ionicons name={item.icon} size={32} color="#0D9488" />
            <Text style={styles.cardText}>{item.title}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  header: { 
    padding: 20, 
    backgroundColor: '#fff', 
    borderBottomWidth: 1, 
    borderBottomColor: '#E5E7EB', 
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', flex: 1, textAlign: 'center' },
  switchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    position: 'absolute',
    right: 16,
  },
  switchBtnText: { fontSize: 12, fontWeight: '700', color: '#0369A1' },
  grid: { 
    padding: 16, 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    justifyContent: 'space-between' 
  },
  card: { 
    width: '48%', 
    backgroundColor: '#fff', 
    borderRadius: 12, 
    padding: 20, 
    marginBottom: 16, 
    alignItems: 'center', 
    shadowColor: '#000', 
    shadowOpacity: 0.05, 
    shadowRadius: 4, 
    elevation: 2 
  },
  cardText: { 
    marginTop: 10, 
    fontSize: 14, 
    fontWeight: '600', 
    color: '#374151', 
    textAlign: 'center' 
  }
});