import apiClient from './client';

export const prayersApi = {
  // GET /api/prayers
  // Returns today's prayer timings with Hijri date, Tahajjud, and Imsak.
  getToday: async () => {
    const response = await apiClient.get('/prayers');
    return response.data; // { success, message, data: { timings, tahajjud_time, imsak_time, date_hijri, ... } }
  },
};
