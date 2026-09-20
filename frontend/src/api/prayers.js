import apiClient from './client';

export const prayersApi = {
  // GET /api/prayers
  // Returns today's prayer timings with Hijri date, Tahajjud, and Imsak.
  getToday: async () => {
    const response = await apiClient.get('/prayers');
    return response.data; // { success, message, data: { timings, tahajjud_time, imsak_time, date_hijri, ... } }
  },

  // POST /api/prayers/refresh — admin/super_admin. Force-fetches from
  // AlAdhan, bypassing the DB cache. Optional `date` = YYYY-MM-DD
  // (defaults to today IST).
  forceRefresh: async (date) => {
    const params = date ? { date } : {};
    const response = await apiClient.post('/prayers/refresh', null, { params });
    return response.data;
  },
};
