import apiClient from './client';
import { networkFirst } from '../services/offlineCache';

const todayIST = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};


export const prayersApi = {
  // GET /api/prayers
  // Returns today's prayer timings with Hijri date, Tahajjud, and Imsak.
  // Saved for offline use, but a saved copy is only offered for the same
  // IST day — yesterday's prayer times shown as today's would be wrong.
  getToday: async () => networkFirst(
    'prayers:today',
    async () => (await apiClient.get('/prayers')).data, // { success, data: { date, timings, tahajjud_time, imsak_time, date_hijri, ... } }
    { usable: (saved) => saved?.data?.date === todayIST() }
  ),

  // POST /api/prayers/refresh — admin/super_admin. Force-fetches from
  // AlAdhan, bypassing the DB cache. Optional `date` = YYYY-MM-DD
  // (defaults to today IST).
  forceRefresh: async (date) => {
    const params = date ? { date } : {};
    const response = await apiClient.post('/prayers/refresh', null, { params });
    return response.data;
  },
};
