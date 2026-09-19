import apiClient from './client';

/**
 * duaApi — client for /api/dua/*
 *
 * Backed by our own DB. Categories response inlines the "featured today"
 * dua so the landing screen renders in one round-trip.
 */
export const duaApi = {
  // GET /api/dua/categories — all categories + featured-today
  getCategories: async () => {
    const response = await apiClient.get('/dua/categories');
    return response.data; // { success, data: { total, categories[], featured_today } }
  },

  // GET /api/dua/featured — just today's featured dua
  getFeatured: async () => {
    const response = await apiClient.get('/dua/featured');
    return response.data;
  },

  // GET /api/dua/:categorySlug — all duas within a category
  getCategory: async (slug) => {
    const response = await apiClient.get(`/dua/${encodeURIComponent(slug)}`);
    return response.data; // { success, data: { category, duas[] } }
  },
};
