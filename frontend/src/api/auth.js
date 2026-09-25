import apiClient from './client';

export const authApi = {
  // Password or Role Login
  login: async (data) => {
    const response = await apiClient.post('/auth/login', data);
    return response.data;
  },

  // Send OTP to user phone number
  // purpose must be 'registration' or 'forgot_password' (required by backend)
  sendOtp: async (phone, purpose) => {
    const response = await apiClient.post('/auth/send-otp', { phone, purpose });
    return response.data;
  },

  // Verify OTP + reset password in one call (forgot-password flow).
  // Distinct from verifyPhone below — this one also sets the new password.
  verifyOtp: async (data) => {
    const response = await apiClient.post('/auth/forgot-password/verify-otp', data);
    return response.data;
  },

  // Verify a phone number ahead of registration.
  // Returns { phone, purpose, verification_token } — the token is a
  // short-lived (15 min) ticket that `register` accepts in place of the
  // OTP, because verifying consumes the code server-side.
  verifyPhone: async ({ phone, otp, purpose = 'registration' }) => {
    const response = await apiClient.post('/auth/verify-otp', { phone, otp, purpose });
    return response.data;
  },

  // Register new user.
  // data: { name, phone, password, gender, occupation, city, location_id,
  //         address, verification_token }   (or legacy `otp`)
  register: async (data) => {
    const response = await apiClient.post('/auth/register', data);
    return response.data;
  },
};

// ─── Locations ────────────────────────────────────────────────────────────────
// Public endpoints — no auth token required.
// Supports cascading picker: city → area → zone → address
//
// Usage:
//   getLocations({ type: 'city' })                          → all cities
//   getLocations({ type: 'zone' })                          → all zones
//   getLocations({ type: 'address', parent_id: zoneId })    → addresses in a zone

export const locationsApi = {
  getLocations: async ({ type, parent_id } = {}) => {
    const params = {};
    if (type) params.type = type;
    if (parent_id) params.parent_id = parent_id;

    const response = await apiClient.get('/locations', { params });
    return response.data; // { success, message, data: Location[] }
  },
};
