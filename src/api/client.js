import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// Replace with your ngrok URL during local development
export const API_BASE_URL = 'https://enlarged-viability-improving.ngrok-free.dev/api';

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