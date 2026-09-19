import apiClient from './client';

/**
 * donationsApi — client for /api/donations/* + /api/admin/donations/*
 *
 * See backend/src/controllers/donationController.js. Standard envelope.
 *
 * Screenshot upload uses multipart/form-data. The `screenshot` param is
 * whatever `expo-image-picker` gave us back: { uri, mimeType?, fileName? }.
 * We attach it to FormData directly — React Native handles the streaming.
 */
export const donationsApi = {
  // POST /api/donations — multipart
  // params: { amount: number, note?: string, screenshot: { uri, mimeType?, fileName? } }
  submit: async ({ amount, note, screenshot }) => {
    const form = new FormData();
    form.append('amount', String(amount));
    if (note) form.append('note', note);

    // RN's fetch/axios accept a { uri, name, type } object as a file part.
    const filename = screenshot?.fileName || `donation-${Date.now()}.jpg`;
    const type     = screenshot?.mimeType || 'image/jpeg';
    form.append('screenshot', {
      uri:  screenshot.uri,
      name: filename,
      type,
    });

    const response = await apiClient.post('/donations', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Long timeout — some screenshots are large + on slow mobile networks.
      timeout: 30000,
      transformRequest: (data) => data, // don't let axios JSON-stringify the FormData
    });
    return response.data;
  },

  // GET /api/donations/my
  getMy: async ({ page = 1, limit = 20, status } = {}) => {
    const params = { page, limit };
    if (status) params.status = status;
    const response = await apiClient.get('/donations/my', { params });
    return response.data;
  },

  // GET /api/admin/donations — super_admin
  listAll: async ({ page = 1, limit = 20, status } = {}) => {
    const params = { page, limit };
    if (status) params.status = status;
    const response = await apiClient.get('/admin/donations', { params });
    return response.data;
  },

  // GET /api/admin/donations/summary — super_admin
  getSummary: async ({ from, to } = {}) => {
    const params = {};
    if (from) params.from = from;
    if (to)   params.to   = to;
    const response = await apiClient.get('/admin/donations/summary', { params });
    return response.data;
  },

  // PATCH /api/admin/donations/:id/verify — super_admin
  verify: async (id) => {
    const response = await apiClient.patch(`/admin/donations/${id}/verify`);
    return response.data;
  },

  // PATCH /api/admin/donations/:id/reject — super_admin. Body: { reason? }
  reject: async (id, reason) => {
    const response = await apiClient.patch(`/admin/donations/${id}/reject`, { reason });
    return response.data;
  },

  // GET /api/payment/info — public. { contact_number, payment_url }
  getPaymentInfo: async () => {
    const response = await apiClient.get('/payment/info');
    return response.data;
  },
};
