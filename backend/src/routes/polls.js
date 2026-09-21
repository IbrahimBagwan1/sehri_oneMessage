'use strict';
const express = require('express');
const router = express.Router();
const { verifyToken, requireRole, requireUserAccess } = require('../middleware/auth');
const {
  validateVote,
  validateSpecialCase,
  validateAllot,
  validateToggle,
} = require('../middleware/pollValidation');
const {
  getActivePoll,
  submitVote,
  getMyResponses,
  getActiveStats,
  getZoneVoters,
  createTodaysPoll,
} = require('../controllers/pollController');
const {
  submitSpecialCase,
  undoSpecialCase,
  getSpecialCases,
  allotSpecialCases,
  togglePoll,
  getPollHistory,
  getDateStats,
} = require('../controllers/pollController2');

// ---------------------------------------------------------------------------
// Route order matters — Express matches top-to-bottom.
// All literal-segment routes (/active/*, /special-cases/*, /history,
// /date/:date/*) MUST come before /:id routes, otherwise Express will
// treat the literal segment as a poll UUID and the handler will never fire.
//
// Safe order:
//   1. /active            (literal)
//   2. /active/stats      (literal)
//   3. /active/toggle     (literal)   ← Person 2
//   4. /my-responses      (literal)
//   5. /special-cases     (literal)   ← Person 2
//   6. /special-cases/allot (literal) ← Person 2
//   7. /history           (literal)   ← Person 2
//   8. /date/:date/stats  (param, but distinct prefix — safe anywhere)  ← Person 2
//   9. /:id/respond       (param)
//  10. /:id/zone-voters   (param)
//  11. /:id/special-case  (param)     ← Person 2
//  12. /:id/special-case/undo (param) ← Person 2
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Person 1 — core voting flow
// ---------------------------------------------------------------------------

// GET /api/polls/active
// Returns today's poll + current phase + the calling user's own response.
router.get('/active', verifyToken, getActivePoll);

// GET /api/polls/active/stats
// Zone-by-zone yes/no counts for today's poll.
router.get('/active/stats', verifyToken, requireRole('admin', 'super_admin'), getActiveStats);

// PATCH /api/polls/active/toggle
// Super admin manually opens or closes today's voting window.
// Body: { is_active: true | false }
router.patch('/active/toggle', verifyToken, requireRole('super_admin'), ...validateToggle, togglePoll);

// POST /api/polls/create-today
// Super admin manual safety net for the (unimplemented) daily cron.
// Idempotent — 409 if a poll for today already exists.
router.post('/create-today', verifyToken, requireRole('super_admin'), createTodaysPoll);

// GET /api/polls/my-responses
// Paginated personal vote history for the calling user.
// ?page=1&limit=20
router.get('/my-responses', verifyToken, requireUserAccess, getMyResponses);

// ---------------------------------------------------------------------------
// Person 2 — literal-segment routes (must stay above /:id routes)
// ---------------------------------------------------------------------------

// GET /api/polls/special-cases
// Today's special case submissions with user details.
// Super admin uses this to review before the allotment window.
router.get('/special-cases', verifyToken, requireRole('super_admin'), getSpecialCases);

// POST /api/polls/special-cases/allot
// Bulk approve/reject special cases. Window: 5 PM – 6 PM IST only.
// Body: { decisions: [{ response_id, decision: 'approved'|'rejected' }] }
router.post('/special-cases/allot', verifyToken, requireRole('super_admin'), ...validateAllot, allotSpecialCases);

// GET /api/polls/history
// Past polls with vote totals, paginated. ?page=1&limit=20
router.get('/history', verifyToken, requireRole('admin', 'super_admin'), getPollHistory);

// GET /api/polls/date/:date/stats
// Zone-by-zone breakdown for any historical date. date = YYYY-MM-DD.
// Safe to place here — distinct /date/ prefix avoids /:id ambiguity.
router.get('/date/:date/stats', verifyToken, requireRole('admin', 'super_admin'), getDateStats);

// ---------------------------------------------------------------------------
// Param-based routes — must come AFTER all literal routes above
// ---------------------------------------------------------------------------

// POST /api/polls/:id/respond
// Submit a yes/no vote during the voting window.
// Body: { response: 'yes' | 'no' }
router.post('/:id/respond', verifyToken, requireUserAccess, ...validateVote, submitVote);

// GET /api/polls/:id/zone-voters
// Names of Yes voters in a zone for a given poll.
// Admin sees own zone only; super_admin may pass ?zone=<name>.
router.get('/:id/zone-voters', verifyToken, requireRole('admin', 'super_admin'), getZoneVoters);

// POST /api/polls/:id/special-case
// Raise a special case during the 10 AM – 5 PM window.
// Body: { type: 'want' | 'dont_want' }
router.post('/:id/special-case', verifyToken, requireUserAccess, ...validateSpecialCase, submitSpecialCase);

// POST /api/polls/:id/special-case/undo
// Retract a special case (only if not yet reviewed by super admin).
router.post('/:id/special-case/undo', verifyToken, requireUserAccess, undoSpecialCase);

module.exports = router;
