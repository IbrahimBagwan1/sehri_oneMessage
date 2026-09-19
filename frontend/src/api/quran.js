import apiClient from './client';

/**
 * quranApi — client for /api/quran/*
 *
 * Backed by our own DB (see backend/src/controllers/quranController.js).
 * The mobile app never talks to a third-party at request time — content
 * is synced server-side by scripts/sync-quran.js.
 */
export const quranApi = {
  // GET /api/quran/chapters — all 114 surahs with metadata
  getChapters: async () => {
    const response = await apiClient.get('/quran/chapters');
    return response.data; // { success, data: { total, chapters[] } }
  },

  // GET /api/quran/:surah — full surah (meta + verses)
  getSurah: async (surahId) => {
    const response = await apiClient.get(`/quran/${surahId}`);
    return response.data; // { success, data: { chapter, verses[] } }
  },
};
