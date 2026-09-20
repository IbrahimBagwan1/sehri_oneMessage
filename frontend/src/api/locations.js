import apiClient from './client';

/**
 * locationsAdminApi — super-admin location-coordinate endpoints.
 *
 * The public `getLocations` list is in api/auth.js as `locationsApi`
 * (registration screen needs it before any token exists). These calls
 * are the admin-side ones.
 */
export const locationsAdminApi = {
  // GET /api/locations/addresses — every PG with coord state
  listAddresses: async () => {
    const response = await apiClient.get('/locations/addresses');
    return response.data;
  },

  // GET /api/locations/needs-coordinates — PGs missing a pin
  listNeedingCoordinates: async () => {
    const response = await apiClient.get('/locations/needs-coordinates');
    return response.data;
  },

  // PATCH /api/locations/:id/coordinates  Body: { latitude, longitude }
  setCoordinates: async (id, latitude, longitude) => {
    const response = await apiClient.patch(`/locations/${id}/coordinates`, { latitude, longitude });
    return response.data;
  },
};
