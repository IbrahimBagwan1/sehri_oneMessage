import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AdminFeedbackScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Feedback</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.placeholder}>Read and manage user feedback</Text>
        <Text style={styles.coming}>Coming soon</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F8FAFC' },
  header:      { paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  title:       { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  body:        { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  placeholder: { fontSize: 15, color: '#64748B', textAlign: 'center' },
  coming:      { fontSize: 13, color: '#94A3B8', marginTop: 8 },
});
