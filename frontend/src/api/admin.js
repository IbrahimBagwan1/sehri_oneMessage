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
  // Voters in a zone with their vote timestamps. Admin sees own zone;
  // super_admin can pass ?zone=. `response` filters the vote value —
  // 'yes' (default, preserves the admin drill-down), 'no', or 'all'.
  getZoneVoters: async (pollId, zone = null, { response: responseFilter } = {}) => {
    const params = {};
    if (zone) params.zone = zone;
    if (responseFilter) params.response = responseFilter;
    const response = await apiClient.get(`/polls/${pollId}/zone-voters`, { params });
    // data: { poll, zone, response_filter, voters, total_yes, total_no, total }
    // each voter: { response_id, response, voted_at, special_case_at, user, ... }
    return response.data;
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

  // ---------------------------------------------------------------------------
  // Search + promote — super_admin only
  // ---------------------------------------------------------------------------

  // GET /api/admin/users/search?q=&page=&limit=
  // Free-text search across name (case-insensitive substring) and phone
  // (digits substring). Returns { total, page, limit, users } where each
  // user includes `existing_roles` so the promote UI can gate options.
  searchUsers: async ({ q, page = 1, limit = 20 } = {}) => {
    const response = await apiClient.get('/admin/users/search', {
      params: { q, page, limit },
    });
    return response.data;
  },

  // POST /api/admin/users/:id/promote
  // Body: { target_role: 'admin' | 'super_admin', zone_location_id?: uuid }
  promoteUser: async (userId, { target_role, zone_location_id } = {}) => {
    const response = await apiClient.post(`/admin/users/${userId}/promote`, {
      target_role,
      zone_location_id,
    });
    return response.data;
  },

  // POST /api/admin/link-user-account
  // Self-service: creates a linked user account for the calling
  // admin/super_admin. Response includes { user_id, available_roles }
  // so the store can refresh the role-switch chips without re-login.
  linkUserAccount: async ({ location_id, address, gender, occupation } = {}) => {
    const response = await apiClient.post('/admin/link-user-account', {
      location_id,
      address,
      gender,
      occupation,
    });
    return response.data;
  },
};
