'use strict';

const express = require('express');
const { param, query, body } = require('express-validator');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/otpValidation');
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
  listZones,
  addZone,
  removeZone,
  reportMessage,
  blockUser,
  unblockUser,
  listBlockedUsers,
} = require('../controllers/chatController');

// ---------------------------------------------------------------------------
// Route order matters — literal-segment routes must come before param routes.
//
// Safe order:
//   1. GET  /groups             (literal)
//   2. POST /groups             (literal)
//   3. GET  /admins             (literal — for group creation picker)
//   3b.GET  /zones              (literal — for the zone picker)
//   4. GET  /groups/:id         (param)
//   5. DELETE /groups/:id       (param)
//   6. GET  /groups/:id/messages      (param + literal)
//   7. POST /groups/:id/messages      (param + literal)
//   8. POST /groups/:id/read          (param + literal)
//   9. POST /groups/:id/members       (param + literal)
//  10. DELETE /groups/:id/messages/:msgId  (param + param)
//  11. DELETE /groups/:id/members/:userId  (param + param)
//  12. POST /groups/:id/zones              (param + literal)
//  13. DELETE /groups/:id/zones/:zoneId    (param + param)
//  14. GET/POST /blocks, DELETE /blocks/:userId   (literal — above /groups/:id)
//  15. POST /groups/:id/messages/:msgId/report    (param + param + literal)
// ---------------------------------------------------------------------------

// GET /api/chat/groups — list groups the caller belongs to
router.get('/groups', verifyToken, getMyGroups);

// POST /api/chat/groups — create a new group (super admin only)
router.post('/groups', verifyToken, requireRole('super_admin'), createGroup);

// GET /api/chat/admins — list admins for the group creation member picker
router.get('/admins', verifyToken, requireRole('super_admin'), listAdmins);

// GET /api/chat/zones — zones + member counts for the zone picker
// ?group_id=<uuid> marks the ones this group already covers
router.get('/zones', verifyToken, requireRole('super_admin'), listZones);

// ---------------------------------------------------------------------------
// Blocks — "I do not want to see this person".
//
// One-way and silent: the blocker stops seeing the blocked person, and the
// blocked person's view is unchanged and they are never told. The reasoning
// is at the top of services/chatModerationService.js.
//
// Literal segments, so they sit above /groups/:id.
// ---------------------------------------------------------------------------

// GET /api/chat/blocks — the caller's own blocked list
router.get('/blocks', verifyToken, listBlockedUsers);

// POST /api/chat/blocks — Body: { user_id, user_type }
router.post(
  '/blocks',
  verifyToken,
  body('user_id').isUUID().withMessage('user_id must be a UUID'),
  body('user_type').isIn(['user', 'admin', 'super_admin'])
    .withMessage('user_type must be user, admin, or super_admin'),
  handleValidationErrors,
  blockUser
);

// DELETE /api/chat/blocks/:userId?user_type=user|admin|super_admin
router.delete(
  '/blocks/:userId',
  verifyToken,
  param('userId').isUUID().withMessage('userId must be a UUID'),
  query('user_type').isIn(['user', 'admin', 'super_admin'])
    .withMessage('user_type must be user, admin, or super_admin'),
  handleValidationErrors,
  unblockUser
);

// GET /api/chat/groups/:id — group details + member list + covered zones
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

// POST /api/chat/groups/:id/messages/:msgId/report
// Body: { reason?, block_sender? }
// Flags a message for moderation, optionally blocking its sender in the
// same action. Idempotent — reporting twice is one report.
router.post(
  '/groups/:id/messages/:msgId/report',
  verifyToken,
  param('id').isUUID().withMessage('group id must be a UUID'),
  param('msgId').isUUID().withMessage('message id must be a UUID'),
  body('reason').optional({ nullable: true }).isString().isLength({ max: 1000 })
    .withMessage('reason must be 1000 characters or fewer'),
  body('block_sender').optional().isBoolean().toBoolean(),
  handleValidationErrors,
  reportMessage
);

// DELETE /api/chat/groups/:id/members/:userId — remove a member
// ?user_type=user|admin|super_admin  (required query param)
// Refuses for members the group's zones put there automatically.
router.delete('/groups/:id/members/:userId', verifyToken, requireRole('super_admin'), removeMember);

// POST /api/chat/groups/:id/zones — cover another zone with this group
// Body: { zone_location_id }
router.post('/groups/:id/zones', verifyToken, requireRole('super_admin'), addZone);

// DELETE /api/chat/groups/:id/zones/:zoneId — stop covering a zone
router.delete('/groups/:id/zones/:zoneId', verifyToken, requireRole('super_admin'), removeZone);

module.exports = router;
