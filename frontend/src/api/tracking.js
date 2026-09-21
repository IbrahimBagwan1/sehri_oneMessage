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

  // GET /api/tracking/eta
  // Driving ETA from today's rider to the calling user's address.
  getEta: async () => {
    const response = await apiClient.get('/tracking/eta');
    return response.data; // { success, data: { rider, eta } }
  },

  // ---------------------------------------------------------------------------
  // Super-admin rider management — the 6 endpoints exposed by
  // backend/src/routes/tracking.js. Every wrapper here is super_admin-only.
  // ---------------------------------------------------------------------------

  // GET /api/tracking/all — every rider with zone + status + last-known location
  getAllRiders: async () => {
    const response = await apiClient.get('/tracking/all');
    return response.data; // { success, data: [rider, ...] }
  },

  // POST /api/tracking — create a rider. Two backend modes (see createRider
  // in trackingController.js):
  //   Mode A (promote existing user): { user_id, zone_location_id?, password }
  //   Mode B (standalone):            { name, phone, password, zone_location_id? }
  createRider: async (payload) => {
    const response = await apiClient.post('/tracking', payload);
    return response.data;
  },

  // PATCH /api/tracking/:id/assign-today — mark rider as today's delivery rider
  assignTodayRider: async (riderId) => {
    const response = await apiClient.patch(`/tracking/${riderId}/assign-today`);
    return response.data;
  },

  // PATCH /api/tracking/unassign-today — clear today's rider assignment.
  // No rider id needed (there's only ever one assignment per day).
  unassignTodayRider: async () => {
    const response = await apiClient.patch('/tracking/unassign-today');
    return response.data;
  },

  // PATCH /api/tracking/:id/toggle — flip is_active (on-duty / off-duty)
  toggleRider: async (riderId) => {
    const response = await apiClient.patch(`/tracking/${riderId}/toggle`);
    return response.data;
  },

  // PATCH /api/tracking/:id/location — manual GPS override (edge cases only)
  // payload: { latitude, longitude, current_address?, eta_minutes? }
  updateLocationManual: async (riderId, payload) => {
    const response = await apiClient.patch(`/tracking/${riderId}/location`, payload);
    return response.data;
  },

  // DELETE /api/tracking/:id — hard delete (also clears today's assignment)
  deleteRider: async (riderId) => {
    const response = await apiClient.delete(`/tracking/${riderId}`);
    return response.data;
  },
};
