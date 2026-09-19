import apiClient from './client';

export const pollsApi = {
  // GET /api/polls/active
  // Returns today's poll, current phase, and the calling user's own response.
  getActive: async () => {
    const response = await apiClient.get('/polls/active');
    return response.data; // { success, data: { poll, phase, my_response } }
  },

  // POST /api/polls/:id/respond
  // Body: { response: 'yes' | 'no' }
  submitVote: async (pollId, vote) => {
    const response = await apiClient.post(`/polls/${pollId}/respond`, { response: vote });
    return response.data;
  },

  // GET /api/polls/my-responses
  // Paginated personal vote history
  getMyResponses: async (page = 1, limit = 20) => {
    const response = await apiClient.get('/polls/my-responses', { params: { page, limit } });
    return response.data;
  },

  // GET /api/polls/history
  // Past polls list, paginated. Admin + super_admin only.
  getHistory: async (page = 1, limit = 20) => {
    const response = await apiClient.get('/polls/history', { params: { page, limit } });
    return response.data; // { success, data: { total, page, limit, polls[] } }
  },

  // GET /api/polls/date/:date/stats
  // Zone-by-zone breakdown for a specific date (YYYY-MM-DD). Admin + super_admin only.
  getDateStats: async (date) => {
    const response = await apiClient.get(`/polls/date/${date}/stats`);
    return response.data; // { success, data: { poll, by_zone, grand_total } }
  },

  // POST /api/polls/:id/special-case
  // Raise a special case during 10AM–5PM window.
  // type: 'want' | 'dont_want'
  submitSpecialCase: async (pollId, type) => {
    const response = await apiClient.post(`/polls/${pollId}/special-case`, { type });
    return response.data;
  },

  // POST /api/polls/:id/special-case/undo
  // Retract a special case (only if not yet reviewed).
  undoSpecialCase: async (pollId) => {
    const response = await apiClient.post(`/polls/${pollId}/special-case/undo`);
    return response.data;
  },

  // GET /api/polls/special-cases
  // Today's special cases list. Super admin only.
  getSpecialCases: async () => {
    const response = await apiClient.get('/polls/special-cases');
    return response.data; // { success, data: { poll, total, pending_count, cases[] } }
  },

  // POST /api/polls/special-cases/allot
  // Bulk approve/reject. Super admin only. Window: 5PM–6PM.
  // decisions: [{ response_id, decision: 'approved' | 'rejected' }]
  allotSpecialCases: async (decisions) => {
    const response = await apiClient.post('/polls/special-cases/allot', { decisions });
    return response.data;
  },

  // PATCH /api/polls/active/toggle
  // Manually open or close today's poll. Super admin only.
  togglePoll: async (is_active) => {
    const response = await apiClient.patch('/polls/active/toggle', { is_active });
    return response.data;
  },
};
