import apiClient from './client';

/**
 * chatApi — client for /api/chat/*
 *
 * Backend contract lives in backend/src/routes/chat.js + chatController.js.
 * Every call returns the standard envelope { success, message, data }.
 */
export const chatApi = {
  // GET /api/chat/groups — groups the caller belongs to + unread counts
  getMyGroups: async () => {
    const response = await apiClient.get('/chat/groups');
    return response.data;
  },

  // POST /api/chat/groups — super_admin only
  // Body: { name, description?, member_ids: [...], zone_location_ids?: [...] }
  // Passing zones makes the group zone-backed: everyone in those zones joins
  // immediately and stays in sync, same as a zone's own default group.
  createGroup: async ({ name, description, member_ids = [], zone_location_ids = [] }) => {
    const response = await apiClient.post('/chat/groups', {
      name, description, member_ids, zone_location_ids,
    });
    return response.data;
  },

  // GET /api/chat/admins — admin picker for group creation (super_admin only)
  listAdminsForPicker: async () => {
    const response = await apiClient.get('/chat/admins');
    return response.data;
  },

  // GET /api/chat/groups/:id — group meta + full member list
  getGroup: async (id) => {
    const response = await apiClient.get(`/chat/groups/${id}`);
    return response.data;
  },

  // DELETE /api/chat/groups/:id — super_admin soft-delete
  deleteGroup: async (id) => {
    const response = await apiClient.delete(`/chat/groups/${id}`);
    return response.data;
  },

  // GET /api/chat/groups/:id/messages?page=&limit=
  getMessages: async (id, { page = 1, limit = 30 } = {}) => {
    const response = await apiClient.get(`/chat/groups/${id}/messages`, { params: { page, limit } });
    return response.data;
  },

  // POST /api/chat/groups/:id/messages  Body: { content, reply_to_id? }
  sendMessage: async (id, { content, reply_to_id }) => {
    const response = await apiClient.post(`/chat/groups/${id}/messages`, { content, reply_to_id });
    return response.data;
  },

  // POST /api/chat/groups/:id/read — mark all messages read
  markRead: async (id) => {
    const response = await apiClient.post(`/chat/groups/${id}/read`);
    return response.data;
  },

  // DELETE /api/chat/groups/:id/messages/:msgId
  deleteMessage: async (groupId, msgId) => {
    const response = await apiClient.delete(`/chat/groups/${groupId}/messages/${msgId}`);
    return response.data;
  },

  // POST /api/chat/groups/:id/members — super_admin only
  // Body: { members: [{ user_id, user_type }] }
  addMembers: async (id, members) => {
    const response = await apiClient.post(`/chat/groups/${id}/members`, { members });
    return response.data;
  },

  // DELETE /api/chat/groups/:id/members/:userId?user_type=user|admin|super_admin
  // 409 MEMBER_IS_AUTOMATIC when the member is there because of a zone link.
  removeMember: async (groupId, userId, userType) => {
    const response = await apiClient.delete(`/chat/groups/${groupId}/members/${userId}`, {
      params: { user_type: userType },
    });
    return response.data;
  },

  // GET /api/chat/zones?group_id= — zones + member counts for the picker
  listZones: async (groupId) => {
    const response = await apiClient.get('/chat/zones', {
      params: groupId ? { group_id: groupId } : {},
    });
    return response.data;
  },

  // POST /api/chat/groups/:id/zones — cover another zone with this group
  addZone: async (groupId, zoneLocationId) => {
    const response = await apiClient.post(`/chat/groups/${groupId}/zones`, {
      zone_location_id: zoneLocationId,
    });
    return response.data;
  },

  // DELETE /api/chat/groups/:id/zones/:zoneId — stop covering a zone
  removeZone: async (groupId, zoneId) => {
    const response = await apiClient.delete(`/chat/groups/${groupId}/zones/${zoneId}`);
    return response.data;
  },

  // ---------------------------------------------------------------------------
  // Trust & safety — reporting and blocking.
  //
  // Both app stores require an app with user messaging to offer in-app
  // reporting of abusive content and in-app blocking of abusive users.
  // ---------------------------------------------------------------------------

  // POST /api/chat/groups/:id/messages/:msgId/report
  // Body: { reason?, block_sender? }
  //
  // Idempotent — reporting the same message twice returns 200 with
  // already_reported: true rather than creating a second report.
  // The reported person is told nothing.
  reportMessage: async (groupId, msgId, { reason, blockSender } = {}) => {
    const response = await apiClient.post(
      `/chat/groups/${groupId}/messages/${msgId}/report`,
      { reason: reason || undefined, block_sender: !!blockSender }
    );
    return response.data; // { data: { report_id, already_reported, blocked_sender, sender_name } }
  },

  // GET /api/chat/blocks — the caller's own blocked list.
  // Also read when a chat room mounts: history is filtered server-side, but
  // a live socket broadcast goes to a room and has no per-recipient view,
  // so the client drops incoming messages from blocked senders too.
  getBlockedUsers: async () => {
    const response = await apiClient.get('/chat/blocks');
    return response.data; // { data: { blocked: [...], total } }
  },

  // POST /api/chat/blocks — Body: { user_id, user_type }
  // One-way and silent: they are never told, and their own view is unchanged.
  blockUser: async (userId, userType) => {
    const response = await apiClient.post('/chat/blocks', {
      user_id: userId, user_type: userType,
    });
    return response.data;
  },

  // DELETE /api/chat/blocks/:userId?user_type=...
  // Their past messages reappear — nothing was deleted, only hidden.
  unblockUser: async (userId, userType) => {
    const response = await apiClient.delete(`/chat/blocks/${userId}`, {
      params: { user_type: userType },
    });
    return response.data;
  },
};

// -----------------------------------------------------------------------------
// chatModerationApi — /api/admin/chat/*
//
// The moderation queue. Admin or super admin: an admin sees reports from
// groups covering their own zone, a super admin sees everything. That
// scoping is enforced server-side, not here.
// -----------------------------------------------------------------------------
export const chatModerationApi = {
  // GET /api/admin/chat/reports?status=pending|reviewed|all&page=&limit=
  listReports: async ({ status = 'pending', page = 1, limit = 20 } = {}) => {
    const response = await apiClient.get('/admin/chat/reports', {
      params: { status, page, limit },
    });
    return response.data; // { data: { reports, total, pending_count, page, limit } }
  },

  // PATCH /api/admin/chat/reports/:id
  // Body: { delete_message?, ban_user?, note? }
  // Sending neither flag marks it reviewed with no action, which is a real
  // outcome and the one most reports deserve.
  resolveReport: async (reportId, { deleteMessage, banUser, note } = {}) => {
    const response = await apiClient.patch(`/admin/chat/reports/${reportId}`, {
      delete_message: !!deleteMessage,
      ban_user: !!banUser,
      note: note || undefined,
    });
    return response.data;
  },

  // GET /api/admin/chat/bans — everyone currently banned
  listBans: async () => {
    const response = await apiClient.get('/admin/chat/bans');
    return response.data;
  },

  // DELETE /api/admin/chat/groups/:groupId/bans/:userId?user_type=...
  liftBan: async (groupId, userId, userType) => {
    const response = await apiClient.delete(`/admin/chat/groups/${groupId}/bans/${userId}`, {
      params: { user_type: userType },
    });
    return response.data;
  },
};
