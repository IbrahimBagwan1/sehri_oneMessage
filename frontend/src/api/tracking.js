import apiClient from './client';

export const trackingApi = {
  // POST /api/tracking/rider-login
  // Public — no token needed
  riderLogin: async (phone, password) => {
    const response = await apiClient.post('/tracking/rider-login', { phone, password });
    return response.data; // { success, data: { accessToken, refreshToken, active_role, profile } }
  },

  // ---- Rider-authenticated calls -----------------------------------------
  // Each takes the rider's token explicitly rather than reading the shared
  // 'access_token'. A rider who is also a member holds two tokens in the
  // same process; passing it per request means there is never a moment
  // where one identity's token sits where the other's belongs.
  // See the request interceptor in api/client.js.

  // PATCH /api/tracking/:id/push-location
  // payload: { latitude, longitude, current_address, eta_minutes, status }
  pushLocation: async (riderId, payload, authToken) => {
    const response = await apiClient.patch(`/tracking/${riderId}/push-location`, payload, { authToken });
    return response.data;
  },

  // GET /api/tracking/delivery-list
  // Rider token required — only works if rider is assigned for today
  getDeliveryList: async (authToken) => {
    const response = await apiClient.get('/tracking/delivery-list', { authToken });
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
  //
  // Stops are generated from the standing roster (who captains which zone),
  // so this takes no rider list in the normal case. Pass captainIds only to
  // narrow tonight's run to the captains actually working — everyone else's
  // zones then report as uncovered, which is the honest answer rather than
  // silently handing their PGs to someone who never agreed to them.
  assignDeliveryRun: async (captainIds) => {
    const response = await apiClient.post(
      '/tracking/delivery-run/assign',
      captainIds && captainIds.length ? { captain_ids: captainIds } : {}
    );
    return response.data;
    // { success, data: { poll_id, captain_count, stop_count, captains,
    //                    orphaned_pgs, uncovered_zones, skipped_captains } }
  },

  // ---------------------------------------------------------------------------
  // Delivery teams — the standing roster. Super-admin only.
  //
  // A team is one captain, who drives and owns the route, plus zero or one
  // helper, who rides along and shares it. Coverage is configured here once
  // and reused every night; the run above is generated from it.
  // ---------------------------------------------------------------------------

  // GET /api/tracking/teams
  getTeamRoster: async () => {
    const response = await apiClient.get('/tracking/teams');
    return response.data;
    // { success, data: { captains, uncovered_zones, available_riders, all_zones } }
  },

  // PUT /api/tracking/teams/:captainId/zones
  // Replaces the captain's zone set outright — send the full list you want
  // them to end up with. 409 if a zone already belongs to another captain.
  setCaptainZones: async (captainId, zoneIds) => {
    const response = await apiClient.put(`/tracking/teams/${captainId}/zones`, {
      zone_ids: zoneIds,
    });
    return response.data;
  },

  // PUT /api/tracking/teams/:captainId/helper
  // null removes the helper and the captain runs solo.
  setCaptainHelper: async (captainId, helperRiderId) => {
    const response = await apiClient.put(`/tracking/teams/${captainId}/helper`, {
      helper_rider_id: helperRiderId,
    });
    return response.data;
  },

  // GET /api/tracking/delivery-run — super-admin only.
  // Full view of today's run grouped by rider.
  getDeliveryRun: async () => {
    const response = await apiClient.get('/tracking/delivery-run');
    return response.data;
  },

  // GET /api/tracking/me — the calling rider's own live row.
  // The profile stored at login is a snapshot; this is the current truth.
  getMyRiderProfile: async (authToken) => {
    const response = await apiClient.get('/tracking/me', { authToken });
    return response.data;
  },

  // GET /api/tracking/my-stops — rider only.
  // The rider's own stops in optimized visit order.
  getMyStops: async (authToken) => {
    const response = await apiClient.get('/tracking/my-stops', { authToken });
    return response.data; // { success, data: { poll, stops: [...] } }
  },

  // POST /api/tracking/my-route/recompute — rider only.
  recomputeMyRoute: async (authToken) => {
    const response = await apiClient.post('/tracking/my-route/recompute', {}, { authToken });
    return response.data;
  },

  // PATCH /api/tracking/stops/:id/mark-delivered — rider only.
  markStopDelivered: async (stopId, authToken) => {
    const response = await apiClient.patch(`/tracking/stops/${stopId}/mark-delivered`, {}, { authToken });
    return response.data;
  },

  // PATCH /api/tracking/stops/:id/undo-delivered — rider only.
  // Exists because mark-delivered is a single tap on a phone at 4am;
  // without this a mistap is permanent and that PG's residents have
  // already been told their food arrived.
  undoStopDelivered: async (stopId, authToken) => {
    const response = await apiClient.patch(`/tracking/stops/${stopId}/undo-delivered`, {}, { authToken });
    return response.data;
  },
};
