'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  getMyGroups,
  createGroup,
  getGroupDetails,
  getMessages,
  sendMessage,
  deleteMessage,
  markAsRead,
  addMembers,
  removeMember,
  deleteGroup,
  listAdmins,
} = require('../controllers/chatController');

// ---------------------------------------------------------------------------
// Route order matters — literal-segment routes must come before param routes.
//
// Safe order:
//   1. GET  /groups             (literal)
//   2. POST /groups             (literal)
//   3. GET  /admins             (literal — for group creation picker)
//   4. GET  /groups/:id         (param)
//   5. DELETE /groups/:id       (param)
//   6. GET  /groups/:id/messages      (param + literal)
//   7. POST /groups/:id/messages      (param + literal)
//   8. POST /groups/:id/read          (param + literal)
//   9. POST /groups/:id/members       (param + literal)
//  10. DELETE /groups/:id/messages/:msgId  (param + param)
//  11. DELETE /groups/:id/members/:userId  (param + param)
// ---------------------------------------------------------------------------

// GET /api/chat/groups — list groups the caller belongs to
router.get('/groups', verifyToken, getMyGroups);

// POST /api/chat/groups — create a new group (super admin only)
router.post('/groups', verifyToken, requireRole('super_admin'), createGroup);

// GET /api/chat/admins — list admins for the group creation member picker
router.get('/admins', verifyToken, requireRole('super_admin'), listAdmins);

// GET /api/chat/groups/:id — group details + member list
router.get('/groups/:id', verifyToken, getGroupDetails);

// DELETE /api/chat/groups/:id — soft-delete a group (super admin only)
router.delete('/groups/:id', verifyToken, requireRole('super_admin'), deleteGroup);

// GET /api/chat/groups/:id/messages — paginated message history
// ?page=1&limit=30
router.get('/groups/:id/messages', verifyToken, getMessages);

// POST /api/chat/groups/:id/messages — send a message
// Body: { content, reply_to_id? }
router.post('/groups/:id/messages', verifyToken, sendMessage);

// POST /api/chat/groups/:id/read — mark all messages as read
router.post('/groups/:id/read', verifyToken, markAsRead);

// POST /api/chat/groups/:id/members — add members (super admin only)
// Body: { members: [{ user_id, user_type }] }
router.post('/groups/:id/members', verifyToken, requireRole('super_admin'), addMembers);

// DELETE /api/chat/groups/:id/messages/:msgId — soft-delete a message
// (owner or super admin — enforced in controller)
router.delete('/groups/:id/messages/:msgId', verifyToken, deleteMessage);

// DELETE /api/chat/groups/:id/members/:userId — remove a member
// ?user_type=user|admin|super_admin  (required query param)
router.delete('/groups/:id/members/:userId', verifyToken, requireRole('super_admin'), removeMember);

module.exports = router;
