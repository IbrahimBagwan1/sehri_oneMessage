import apiClient from './client';

/**
 * usersApi — client for /api/users/*
 *
 * Covers the self-serve calls (getMe, requestProfileEdit, deleteMe) and
 * the admin review calls (getProfileEditRequests, reviewProfileEditRequest,
 * deleteUserById).
 *
 * The zone-scoped list + approve-user calls live in adminApi (admin.js);
 * that file is kept dashboard-focused. usersApi is for profile / account
 * management.
 */
export const usersApi = {
  // GET /api/users/me — the calling user's profile with resolved zone
  getMe: async () => {
    const response = await apiClient.get('/users/me');
    return response.data;
  },

  // DELETE /api/users/me — self-delete (soft, anonymized)
  deleteMe: async () => {
    const response = await apiClient.delete('/users/me');
    return response.data;
  },

  // POST /api/users/request-profile-edit
  // Body: { requested_changes: { name?, gender?, occupation?, city?, location_id?, address? } }
  requestProfileEdit: async (requested_changes) => {
    const response = await apiClient.post('/users/request-profile-edit', { requested_changes });
    return response.data;
  },

  // GET /api/users/profile-edit-requests?status=pending|approved|rejected
  // Admin (own zone) / super_admin (all)
  getProfileEditRequests: async ({ status } = {}) => {
    const params = status ? { status } : {};
    const response = await apiClient.get('/users/profile-edit-requests', { params });
    return response.data;
  },

  // PATCH /api/users/profile-edit-requests/:id/review
  // Body: { decision: 'approved'|'rejected', admin_note? }
  reviewProfileEditRequest: async (id, decision, admin_note) => {
    const response = await apiClient.patch(`/users/profile-edit-requests/${id}/review`, {
      decision,
      admin_note,
    });
    return response.data;
  },

  // DELETE /api/users/:id — super_admin admin-side soft delete
  deleteUserById: async (id) => {
    const response = await apiClient.delete(`/users/${id}`);
    return response.data;
  },

  // PATCH /api/users/me/push-token — register/clear Expo push token.
  // Called by services/pushService.js; exposed here for symmetry.
  setPushToken: async (token) => {
    const response = await apiClient.patch('/users/me/push-token', { token });
    return response.data;
  },
};
