import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// API base URL is read from an EXPO_PUBLIC_ env var so every developer
// can point at their own ngrok tunnel (or LAN IP) without editing this
// file. Expo inlines EXPO_PUBLIC_* variables at bundle time from
// `frontend/.env` — see `frontend/.env.example` for the format.
//
// Fallback: an unreachable placeholder that makes the mistake loud. If
// you see requests going here, you forgot to set EXPO_PUBLIC_API_BASE_URL.
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://SET-EXPO_PUBLIC_API_BASE_URL-in-frontend-dotenv.invalid/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
  timeout: 10000,
});

// Automatically attach stored JWT token to every outgoing request
apiClient.interceptors.request.use(
  async (config) => {
    const token = await SecureStore.getItemAsync('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default apiClient;