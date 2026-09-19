import apiClient from './client';

export const trackingApi = {
  // POST /api/tracking/rider-login
  // Public — no token needed
  riderLogin: async (phone, password) => {
    const response = await apiClient.post('/tracking/rider-login', { phone, password });
    return response.data; // { success, data: { accessToken, refreshToken, active_role, profile } }
  },

  // PATCH /api/tracking/:id/push-location
  // Rider token required
  // payload: { latitude, longitude, current_address, eta_minutes, status }
  pushLocation: async (riderId, payload) => {
    const response = await apiClient.patch(`/tracking/${riderId}/push-location`, payload);
    return response.data;
  },

  // GET /api/tracking/delivery-list
  // Rider token required — only works if rider is assigned for today
  getDeliveryList: async () => {
    const response = await apiClient.get('/tracking/delivery-list');
    return response.data; // { success, data: { poll_date, total, by_zone } }
  },

  // GET /api/tracking/active
  // User token required — returns today's assigned rider's live location
  getActiveRider: async () => {
    const response = await apiClient.get('/tracking/active');
    return response.data; // { success, data: { rider } }
  },
};
