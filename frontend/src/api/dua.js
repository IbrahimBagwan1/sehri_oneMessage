import apiClient from './client';
import { networkFirst } from '../services/offlineCache';

/**
 * duaApi — client for /api/dua/*
 *
 * Backed by our own DB. Categories response inlines the "featured today"
 * dua so the landing screen renders in one round-trip.
 */
export const duaApi = {
  // GET /api/dua/categories — all categories + featured-today
  // Saved for offline use.
  getCategories: async () => networkFirst(
    'dua:categories',
    async () => (await apiClient.get('/dua/categories')).data // { success, data: { total, categories[], featured_today } }
  ),

  // GET /api/dua/featured — just today's featured dua
  getFeatured: async () => {
    const response = await apiClient.get('/dua/featured');
    return response.data;
  },

  // GET /api/dua/:categorySlug — all duas within a category
  getCategory: async (slug) => networkFirst(
    `dua:category:${slug}`,
    async () => (await apiClient.get(`/dua/${encodeURIComponent(slug)}`)).data // { success, data: { category, duas[] } }
  ),

  // POST /api/dua/sync — super_admin only. Reads bundled duas-seed.json.
  triggerSync: async () => {
    const response = await apiClient.post('/dua/sync');
    return response.data;
  },
};
