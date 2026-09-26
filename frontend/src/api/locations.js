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

  // POST /api/locations/address
  // Body: { name, parent_id (zone), latitude?, longitude? }
  // Creates a new PG. Coordinates are optional at create — a PG can be
  // pinned later from the map picker.
  createAddress: async ({ name, parent_id, latitude, longitude } = {}) => {
    const body = { name, parent_id };
    if (latitude != null && longitude != null) {
      body.latitude  = latitude;
      body.longitude = longitude;
    }
    const response = await apiClient.post('/locations/address', body);
    return response.data;
  },

  // POST /api/locations
  // Body: { name, type: city|region|area|zone|address, parent_id?, latitude?, longitude? }
  //
  // Creates at ANY level of the tree. Creating a zone also assigns its
  // zone_key (what every vote is filed under) and provisions its group chat,
  // both server-side — the response reports whether the chat was created.
  createLocation: async ({ name, type, parent_id, latitude, longitude } = {}) => {
    const body = { name, type };
    if (parent_id) body.parent_id = parent_id;
    if (latitude != null && longitude != null) {
      body.latitude  = latitude;
      body.longitude = longitude;
    }
    const response = await apiClient.post('/locations', body);
    return response.data;
  },

  // PATCH /api/locations/:id  Body: { name?, parent_id? }
  // Renames or moves ANY location, not just a PG. Coord updates keep going
  // through setCoordinates above — this endpoint deliberately takes no
  // lat/lng. Renaming a zone never changes its zone_key, so vote history
  // survives; it does rename the zone's group chat to match.
  updateAddress: async (id, { name, parent_id } = {}) => {
    const body = {};
    if (name !== undefined)      body.name = name;
    if (parent_id !== undefined) body.parent_id = parent_id;
    const response = await apiClient.patch(`/locations/${id}`, body);
    return response.data;
  },

  // DELETE /api/locations/:id
  // Soft-deletes any location. Refuses while active children or linked users
  // remain; force=true overrides both. Removing a zone also closes its chat.
  deleteAddress: async (id, { force = false } = {}) => {
    const response = await apiClient.delete(`/locations/${id}`, {
      params: force ? { force: 'true' } : undefined,
    });
    return response.data;
  },
};
