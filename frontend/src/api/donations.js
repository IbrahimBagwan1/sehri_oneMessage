import apiClient from './client';

/**
 * donationsApi — client for /api/donations/*
 *
 * Response envelope for every call:
 *   { success, message, data }
 *
 * The endpoints are documented alongside their backend controller in
 * backend/src/controllers/donationController.js.
 */
export const donationsApi = {
  // POST /api/donations/submit
  // Body: { amount, note? }
  submit: async ({ amount, note }) => {
    const response = await apiClient.post('/donations/submit', { amount, note });
    return response.data;
  },

  // GET /api/donations/history?page=1&limit=20&status=pending|verified|rejected
  getHistory: async ({ page = 1, limit = 20, status } = {}) => {
    const params = { page, limit };
    if (status) params.status = status;
    const response = await apiClient.get('/donations/history', { params });
    return response.data;
  },

  // GET /api/donations/all?page=1&limit=20&status=...
  // Admin (own zone) / super_admin (all)
  getAll: async ({ page = 1, limit = 20, status } = {}) => {
    const params = { page, limit };
    if (status) params.status = status;
    const response = await apiClient.get('/donations/all', { params });
    return response.data;
  },

  // GET /api/donations/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Admin (own zone) / super_admin (all)
  getSummary: async ({ from, to } = {}) => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    const response = await apiClient.get('/donations/summary', { params });
    return response.data;
  },

  // PATCH /api/donations/:id/status  Body: { status: 'verified'|'rejected' }
  updateStatus: async (id, status) => {
    const response = await apiClient.patch(`/donations/${id}/status`, { status });
    return response.data;
  },
};
