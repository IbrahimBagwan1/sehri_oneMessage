import apiClient from './client';

export const adminApi = {
  // ---------------------------------------------------------------------------
  // Polls
  // ---------------------------------------------------------------------------

  // GET /api/polls/active/stats
  // Zone-by-zone yes/no counts for today's poll.
  getActiveStats: async () => {
    const response = await apiClient.get('/polls/active/stats');
    return response.data; // { success, data: { poll, phase, by_zone, grand_total } }
  },

  // GET /api/polls/:id/zone-voters
  // Names of Yes voters in a zone. Admin sees own zone; super_admin can pass ?zone=
  getZoneVoters: async (pollId, zone = null) => {
    const params = zone ? { zone } : {};
    const response = await apiClient.get(`/polls/${pollId}/zone-voters`, { params });
    return response.data; // { success, data: { poll, zone, voters, total_yes } }
  },

  // GET /api/polls/history
  // Past polls list (admin + super_admin)
  getPollHistory: async () => {
    const response = await apiClient.get('/polls/history');
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  // GET /api/users?status=pending
  // Admin sees only their zone's users; super_admin sees all
  getUsers: async (status = null) => {
    const params = status ? { status } : {};
    const response = await apiClient.get('/users', { params });
    return response.data; // { success, data: User[] }
  },

  // PATCH /api/users/:id/status
  // Body: { status: 'approved' | 'rejected' }
  updateUserStatus: async (userId, status) => {
    const response = await apiClient.patch(`/users/${userId}/status`, { status });
    return response.data;
  },

  // GET /api/users/profile-edit-requests
  getProfileEditRequests: async () => {
    const response = await apiClient.get('/users/profile-edit-requests');
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------

  // GET /api/feedback
  getFeedback: async () => {
    const response = await apiClient.get('/feedback');
    return response.data;
  },

  // PATCH /api/feedback/:id/read
  markFeedbackRead: async (id) => {
    const response = await apiClient.patch(`/feedback/${id}/read`);
    return response.data;
  },
};
