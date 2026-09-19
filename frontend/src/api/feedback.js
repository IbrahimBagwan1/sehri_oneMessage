import apiClient from './client';

/**
 * feedbackApi — client for /api/feedback/*
 *
 * Response envelope for every call:
 *   { success, message, data }
 *
 * See backend/src/controllers/feedbackController.js.
 */
export const feedbackApi = {
  // POST /api/feedback  Body: { category, message }
  // category: 'suggestion' | 'complaint' | 'bug' | 'appreciation' | 'other'
  submit: async ({ category, message }) => {
    const response = await apiClient.post('/feedback', { category, message });
    return response.data;
  },

  // GET /api/feedback/my?page=1&limit=20
  getMy: async ({ page = 1, limit = 20 } = {}) => {
    const response = await apiClient.get('/feedback/my', { params: { page, limit } });
    return response.data;
  },

  // GET /api/feedback?page=1&limit=20&category=...&is_read=true|false
  // Admin (own zone) / super_admin (all)
  list: async ({ page = 1, limit = 20, category, is_read } = {}) => {
    const params = { page, limit };
    if (category) params.category = category;
    if (is_read !== undefined) params.is_read = String(is_read);
    const response = await apiClient.get('/feedback', { params });
    return response.data;
  },

  // PATCH /api/feedback/:id/read
  markRead: async (id) => {
    const response = await apiClient.patch(`/feedback/${id}/read`);
    return response.data;
  },
};
