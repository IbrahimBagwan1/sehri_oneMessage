import apiClient from './client';
import { networkFirst } from '../services/offlineCache';

/**
 * quranApi — client for /api/quran/*
 *
 * Backed by our own DB (see backend/src/controllers/quranController.js).
 * The mobile app never talks to a third-party at request time — the corpus
 * is synced server-side by scripts/sync-quran.js, and the Ayat of the Day is
 * cached server-side too (at most one upstream call per UTC day, for the
 * whole community).
 */
export const quranApi = {
  // GET /api/quran/chapters — all 114 surahs with metadata
  // Saved for offline reading — Qur'an content never changes.
  getChapters: async () => networkFirst(
    'quran:chapters',
    async () => (await apiClient.get('/quran/chapters')).data // { success, data: { total, chapters[] } }
  ),

  // GET /api/quran/ayat-of-the-day — today's verse, chosen by islamic.app.
  // Not one of ours: the selection is theirs, the same for everyone that day.
  // Returns { date, stale, arabic, translation, translator, surah_name,
  //           surah_number, ayah_number, reference }.
  getAyatOfTheDay: async () => networkFirst(
    'quran:ayat-of-the-day',
    async () => (await apiClient.get('/quran/ayat-of-the-day')).data
  ),

  // GET /api/quran/:surah — full surah (meta + verses)
  getSurah: async (surahId) => networkFirst(
    `quran:surah:${surahId}`,
    async () => (await apiClient.get(`/quran/${surahId}`)).data // { success, data: { chapter, verses[] } }
  ),

  // POST /api/quran/sync — super_admin only. Fire-and-forget on the
  // backend; returns 202. Takes ~30–60s server-side (114 surahs).
  triggerSync: async () => {
    const response = await apiClient.post('/quran/sync');
    return response.data;
  },
};
