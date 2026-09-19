import apiClient from './client';

/**
 * chatApi — client for /api/chat/*
 *
 * Backend contract lives in backend/src/routes/chat.js + chatController.js.
 * Every call returns the standard envelope { success, message, data }.
 */
export const chatApi = {
  // GET /api/chat/groups — groups the caller belongs to + unread counts
  getMyGroups: async () => {
    const response = await apiClient.get('/chat/groups');
    return response.data;
  },

  // POST /api/chat/groups — super_admin only
  // Body: { name, description?, member_ids: [{ user_id, user_type }] }
  createGroup: async ({ name, description, member_ids = [] }) => {
    const response = await apiClient.post('/chat/groups', { name, description, member_ids });
    return response.data;
  },

  // GET /api/chat/admins — admin picker for group creation (super_admin only)
  listAdminsForPicker: async () => {
    const response = await apiClient.get('/chat/admins');
    return response.data;
  },

  // GET /api/chat/groups/:id — group meta + full member list
  getGroup: async (id) => {
    const response = await apiClient.get(`/chat/groups/${id}`);
    return response.data;
  },

  // DELETE /api/chat/groups/:id — super_admin soft-delete
  deleteGroup: async (id) => {
    const response = await apiClient.delete(`/chat/groups/${id}`);
    return response.data;
  },

  // GET /api/chat/groups/:id/messages?page=&limit=
  getMessages: async (id, { page = 1, limit = 30 } = {}) => {
    const response = await apiClient.get(`/chat/groups/${id}/messages`, { params: { page, limit } });
    return response.data;
  },

  // POST /api/chat/groups/:id/messages  Body: { content, reply_to_id? }
  sendMessage: async (id, { content, reply_to_id }) => {
    const response = await apiClient.post(`/chat/groups/${id}/messages`, { content, reply_to_id });
    return response.data;
  },

  // POST /api/chat/groups/:id/read — mark all messages read
  markRead: async (id) => {
    const response = await apiClient.post(`/chat/groups/${id}/read`);
    return response.data;
  },

  // DELETE /api/chat/groups/:id/messages/:msgId
  deleteMessage: async (groupId, msgId) => {
    const response = await apiClient.delete(`/chat/groups/${groupId}/messages/${msgId}`);
    return response.data;
  },

  // POST /api/chat/groups/:id/members — super_admin only
  // Body: { members: [{ user_id, user_type }] }
  addMembers: async (id, members) => {
    const response = await apiClient.post(`/chat/groups/${id}/members`, { members });
    return response.data;
  },

  // DELETE /api/chat/groups/:id/members/:userId?user_type=user|admin|super_admin
  removeMember: async (groupId, userId, userType) => {
    const response = await apiClient.delete(`/chat/groups/${groupId}/members/${userId}`, {
      params: { user_type: userType },
    });
    return response.data;
  },
};
