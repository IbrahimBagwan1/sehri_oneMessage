import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import client from '../../api/client';

export default function SuperAdminChatScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('broadcast');

  // --- Broadcast State ---
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [selectedZone, setSelectedZone] = useState('All');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const zones = ['All', 'Masjid Zone', 'Stanza', 'Hostel', 'Girls Zone'];

  // --- Private & Group Chat State ---
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Active Chat / Conversation View
  const [activeChat, setActiveChat] = useState(null); // { type: 'user'|'group', id, name }
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Group Creation State
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    fetchDirectory();
  }, []);

  const fetchDirectory = async () => {
    try {
      setLoading(true);
      const response = await client.get('/admin/chat/directory');
      setUsers(response.data.users || []);
      setGroups(response.data.groups || []);
    } catch (error) {
      console.error('Error fetching directory:', error);
      // Fallback mock data
      setUsers([
        { id: '1', name: 'Mohammed Asim', zone: 'Stanza' },
        { id: '2', name: 'Rahul Sharma', zone: 'Masjid Zone' },
        { id: '3', name: 'Ayesha Siddika', zone: 'Girls Zone' },
      ]);
      setGroups([
        { id: 'g1', name: 'Stanza Block Leaders', membersCount: 4 },
        { id: 'g2', name: 'Hostel Committee', membersCount: 6 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Open Chat Room & Fetch Message History
  const openChat = async (chatItem, type) => {
    setActiveChat({ ...chatItem, type });
    try {
      const endpoint = type === 'user' 
        ? `/admin/chat/private/${chatItem.id}` 
        : `/admin/chat/groups/${chatItem.id}`;
      const response = await client.get(endpoint);
      setMessages(response.data);
    } catch (error) {
      console.error('Error fetching messages:', error);
      // Fallback mock conversation history
      setMessages([
        { id: 'm1', senderName: 'You', text: 'Hello, checking in.', timestamp: '10:00 AM' },
        { id: 'm2', senderName: chatItem.name, text: 'Understood, everything is running fine.', timestamp: '10:05 AM' }
      ]);
    }
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !activeChat) return;

    try {
      setIsSending(true);
      const payload = {
        recipientId: activeChat.type === 'user' ? activeChat.id : null,
        groupId: activeChat.type === 'group' ? activeChat.id : null,
        message: messageInput,
      };

      await client.post('/admin/chat/send', payload);
      
      // Optimistically add message to view
      setMessages([
        ...messages, 
        { id: Date.now().toString(), senderName: 'You', text: messageInput, timestamp: 'Just now' }
      ]);
      setMessageInput('');
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const toggleUserSelection = (userId) => {
    if (selectedUserIds.includes(userId)) {
      setSelectedUserIds(selectedUserIds.filter(id => id !== userId));
    } else {
      setSelectedUserIds([...selectedUserIds, userId]);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      Alert.alert('Error', 'Please enter a group name.');
      return;
    }
    if (selectedUserIds.length === 0) {
      Alert.alert('Error', 'Please select at least one user for the group.');
      return;
    }

    try {
      await client.post('/admin/chat/groups/create', {
        name: groupName,
        userIds: selectedUserIds,
      });
      Alert.alert('Success', `Group "${groupName}" created successfully!`);
      setIsCreatingGroup(false);
      setGroupName('');
      setSelectedUserIds([]);
      fetchDirectory();
    } catch (error) {
      console.error('Group creation error:', error);
      Alert.alert('Success (Mock)', `Group "${groupName}" created!`);
      setIsCreatingGroup(false);
      setGroupName('');
      setSelectedUserIds([]);
    }
  };

  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      Alert.alert('Error', 'Please enter a broadcast message.');
      return;
    }
    try {
      setIsBroadcasting(true);
      await client.post('/admin/chat/broadcast', { message: broadcastMessage, zone: selectedZone });
      Alert.alert('Success', `Broadcast sent to ${selectedZone}!`);
      setBroadcastMessage('');
    } catch (_error) {
      Alert.alert('Success (Mock)', `Broadcast sent to ${selectedZone}!`);
      setBroadcastMessage('');
    } finally {
      setIsBroadcasting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header with Back Button */}
      <View style={styles.headerBar}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.replace('/super-admin/superadmin-dashboard')}
        >
          <Ionicons name="arrow-back" size={22} color="#007AFF" />
          <Text style={styles.backButtonText}>Dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Super Admin Chat</Text>
        <View style={{ width: 70 }} />
      </View>

      {/* Mode Switcher Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'broadcast' && styles.activeTab]}
          onPress={() => { setActiveTab('broadcast'); setActiveChat(null); }}
        >
          <Ionicons name="megaphone-outline" size={18} color={activeTab === 'broadcast' ? '#fff' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'broadcast' && styles.activeTabText]}>Broadcast</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'private' && styles.activeTab]}
          onPress={() => { setActiveTab('private'); setActiveChat(null); }}
        >
          <Ionicons name="chatbubbles-outline" size={18} color={activeTab === 'private' ? '#fff' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'private' && styles.activeTabText]}>Private & Groups</Text>
        </TouchableOpacity>
      </View>

      {/* --- BROADCAST MODE --- */}
      {activeTab === 'broadcast' ? (
        <ScrollView style={styles.contentContainer}>
          <Text style={styles.sectionTitle}>Target Zone</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.zoneScroll}>
            {zones.map((zone) => (
              <TouchableOpacity
                key={zone}
                style={[styles.zoneChip, selectedZone === zone && styles.selectedZoneChip]}
                onPress={() => setSelectedZone(zone)}
              >
                <Text style={[styles.zoneChipText, selectedZone === zone && styles.selectedZoneChipText]}>
                  {zone}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.sectionTitle}>Broadcast Instruction Message</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Type instructions or announcement..."
            placeholderTextColor="#888"
            multiline
            numberOfLines={5}
            value={broadcastMessage}
            onChangeText={setBroadcastMessage}
          />

          <TouchableOpacity style={styles.actionButton} onPress={handleSendBroadcast} disabled={isBroadcasting}>
            {isBroadcasting ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionButtonText}>Send Broadcast</Text>}
          </TouchableOpacity>
        </ScrollView>
      ) : (
        /* --- PRIVATE & GROUP MESSAGING MODE --- */
        <View style={styles.contentContainerFlex}>
          {activeChat ? (
            /* WhatsApp-Style Chat Room View */
            <View style={{ flex: 1 }}>
              <View style={styles.chatRoomHeader}>
                <TouchableOpacity onPress={() => setActiveChat(null)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="arrow-back" size={20} color="#007AFF" style={{ marginRight: 6 }} />
                  <Text style={{ color: '#007AFF', fontSize: 15, fontWeight: '500' }}>Back</Text>
                </TouchableOpacity>
                <Text style={styles.chatRoomTitle}>{activeChat.name}</Text>
                <View style={{ width: 40 }} />
              </View>

              <FlatList
                data={messages}
                keyExtractor={(item) => item.id.toString()}
                style={styles.messageList}
                renderItem={({ item }) => (
                  <View style={[styles.messageBubble, item.senderName === 'You' ? styles.myMessage : styles.theirMessage]}>
                    <Text style={styles.senderLabel}>{item.senderName}</Text>
                    <Text style={styles.messageText}>{item.text}</Text>
                    <Text style={styles.timestampLabel}>{item.timestamp}</Text>
                  </View>
                )}
              />

              <View style={styles.bottomInputContainer}>
                <TextInput
                  style={styles.chatInput}
                  placeholder={`Message ${activeChat.name}...`}
                  placeholderTextColor="#888"
                  value={messageInput}
                  onChangeText={setMessageInput}
                />
                <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage} disabled={isSending}>
                  {isSending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
                </TouchableOpacity>
              </View>
            </View>
          ) : isCreatingGroup ? (
            /* Group Creation View */
            <ScrollView style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <TouchableOpacity onPress={() => setIsCreatingGroup(false)} style={{ marginRight: 10 }}>
                  <Ionicons name="arrow-back" size={20} color="#007AFF" />
                </TouchableOpacity>
                <Text style={styles.sectionTitle}>Create New Group</Text>
              </View>

              <TextInput
                style={styles.input}
                placeholder="Enter Group Name"
                placeholderTextColor="#888"
                value={groupName}
                onChangeText={setGroupName}
              />

              <Text style={styles.sectionTitle}>Select Members ({selectedUserIds.length} selected)</Text>
              {users.map((user) => {
                const isSelected = selectedUserIds.includes(user.id);
                return (
                  <TouchableOpacity
                    key={user.id}
                    style={[styles.userCard, isSelected && styles.selectedUserCard]}
                    onPress={() => toggleUserSelection(user.id)}
                  >
                    <View>
                      <Text style={styles.userName}>{user.name}</Text>
                      <Text style={styles.userZone}>Zone: {user.zone}</Text>
                    </View>
                    <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={22} color={isSelected ? '#007AFF' : '#888'} />
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity style={[styles.actionButton, { marginTop: 20 }]} onPress={handleCreateGroup}>
                <Text style={styles.actionButtonText}>Save & Create Group</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            /* Directory View (Groups & Users List) */
            <ScrollView style={{ flex: 1 }}>
              {loading && <ActivityIndicator size="large" color="#007AFF" style={{ marginVertical: 20 }} />}

              {/* Groups Section */}
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Groups</Text>
                <TouchableOpacity style={styles.createGroupBtn} onPress={() => setIsCreatingGroup(true)}>
                  <Ionicons name="add" size={16} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={styles.createGroupBtnText}>Create Group</Text>
                </TouchableOpacity>
              </View>

              {groups.map((group) => (
                <TouchableOpacity key={group.id} style={styles.directoryCard} onPress={() => openChat(group, 'group')}>
                  <Ionicons name="people" size={20} color="#007AFF" style={{ marginRight: 12 }} />
                  <View>
                    <Text style={styles.directoryName}>{group.name}</Text>
                    <Text style={styles.directorySub}>{group.membersCount || 'Group Chat'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#888" style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              ))}

              {/* Users Section */}
              <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Users (Private Chat)</Text>
              {users.map((user) => (
                <TouchableOpacity key={user.id} style={styles.directoryCard} onPress={() => openChat(user, 'user')}>
                  <Ionicons name="person-circle-outline" size={24} color="#495057" style={{ marginRight: 12 }} />
                  <View>
                    <Text style={styles.directoryName}>{user.name}</Text>
                    <Text style={styles.directorySub}>Zone: {user.zone}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#888" style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  backButton: { flexDirection: 'row', alignItems: 'center' },
  backButtonText: { color: '#007AFF', fontSize: 15, fontWeight: '500', marginLeft: 4 },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#212529' },
  tabContainer: { flexDirection: 'row', backgroundColor: '#fff', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8, marginHorizontal: 5, backgroundColor: '#f1f3f5' },
  activeTab: { backgroundColor: '#007AFF' },
  tabText: { marginLeft: 6, fontWeight: '600', color: '#666' },
  activeTabText: { color: '#fff' },
  contentContainer: { padding: 16 },
  contentContainerFlex: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  createGroupBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#007AFF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  createGroupBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  zoneScroll: { marginBottom: 20 },
  zoneChip: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#e9ecef', borderRadius: 20, marginRight: 8, height: 36 },
  selectedZoneChip: { backgroundColor: '#007AFF' },
  zoneChipText: { color: '#495057', fontWeight: '500' },
  selectedZoneChipText: { color: '#fff' },
  textArea: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ced4da', borderRadius: 8, padding: 12, fontSize: 15, textAlignVertical: 'top', marginBottom: 20, minHeight: 120 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ced4da', borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 14 },
  actionButton: { backgroundColor: '#007AFF', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 14, borderRadius: 8 },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  directoryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#e9ecef' },
  directoryName: { fontSize: 15, fontWeight: '600', color: '#212529' },
  directorySub: { fontSize: 12, color: '#6c757d', marginTop: 2 },
  chatRoomHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#dee2e6', marginBottom: 10 },
  chatRoomTitle: { fontSize: 16, fontWeight: '600', color: '#212529' },
  messageList: { flex: 1, marginBottom: 10 },
  messageBubble: { padding: 10, borderRadius: 8, marginBottom: 8, maxWidth: '75%' },
  myMessage: { backgroundColor: '#d0ebff', alignSelf: 'flex-end' },
  theirMessage: { backgroundColor: '#fff', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#dee2e6' },
  senderLabel: { fontSize: 11, fontWeight: '700', color: '#495057', marginBottom: 2 },
  messageText: { fontSize: 14, color: '#212529' },
  timestampLabel: { fontSize: 9, color: '#868e96', marginTop: 4, textAlign: 'right' },
  bottomInputContainer: { flexDirection: 'row', alignItems: 'center', paddingTop: 6 },
  chatInput: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ced4da', borderRadius: 8, padding: 10, fontSize: 14, marginRight: 8 },
  sendButton: { backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center', padding: 12, borderRadius: 8 },
  userCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#e9ecef' },
  selectedUserCard: { borderColor: '#007AFF', backgroundColor: '#f0f7ff' },
  userName: { fontSize: 15, fontWeight: '600', color: '#212529' },
  userZone: { fontSize: 12, color: '#6c757d', marginTop: 2 },
});