import apiClient from './client';

/**
 * broadcastsApi — client for /api/broadcasts/*
 *
 * Super-admin only. Every call returns { success, message, data }.
 * Auth is enforced server-side; this file makes no attempt to gate.
 */
export const broadcastsApi = {
  // POST /api/broadcasts
  // Body: { title?, message, target_location_id? }
  // If target_location_id is omitted (or null), the push goes to every
  // approved user across all zones.
  send: async ({ title, message, target_location_id } = {}) => {
    const response = await apiClient.post('/broadcasts', {
      title: title || undefined,
      message,
      target_location_id: target_location_id || undefined,
    });
    return response.data;
  },

  // GET /api/broadcasts?limit=50
  // Returns audit history, newest first.
  list: async ({ limit = 50 } = {}) => {
    const response = await apiClient.get('/broadcasts', { params: { limit } });
    return response.data;
  },
};
