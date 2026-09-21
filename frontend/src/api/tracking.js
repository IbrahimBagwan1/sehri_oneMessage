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

  // ---------------------------------------------------------------------------
  // Multi-rider delivery run
  // ---------------------------------------------------------------------------

  // POST /api/tracking/delivery-run/assign — super-admin only.
  // Body: { rider_ids: [uuid, ...] }
  assignDeliveryRun: async (riderIds) => {
    const response = await apiClient.post('/tracking/delivery-run/assign', {
      rider_ids: riderIds,
    });
    return response.data; // { success, data: { poll_id, rider_count, stop_count, orphaned_pgs } }
  },

  // GET /api/tracking/delivery-run — super-admin only.
  // Full view of today's run grouped by rider.
  getDeliveryRun: async () => {
    const response = await apiClient.get('/tracking/delivery-run');
    return response.data;
  },

  // GET /api/tracking/my-stops — rider only.
  // The rider's own stops in optimized visit order.
  getMyStops: async () => {
    const response = await apiClient.get('/tracking/my-stops');
    return response.data; // { success, data: { poll, stops: [...] } }
  },

  // POST /api/tracking/my-route/recompute — rider only.
  recomputeMyRoute: async () => {
    const response = await apiClient.post('/tracking/my-route/recompute');
    return response.data;
  },

  // PATCH /api/tracking/stops/:id/mark-delivered — rider only.
  markStopDelivered: async (stopId) => {
    const response = await apiClient.patch(`/tracking/stops/${stopId}/mark-delivered`);
    return response.data;
  },
};
