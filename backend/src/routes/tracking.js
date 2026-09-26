'use strict';
const express = require('express');
const router = express.Router();
const { verifyToken, requireRole, requireUserAccess } = require('../middleware/auth');
const {
  riderLogin,
  createRider,
  getAllRiders,
  assignTodaysRider,
  unassignTodaysRider,
  toggleRider,
  updateLocationManual,
  pushLocation,
  getActiveRider,
  getDeliveryList,
  deleteRider,
  getEta,
  assignDeliveryRun,
  getDeliveryRun,
  getMyStops,
  markStopDelivered,
  undoStopDelivered,
  getMyRiderProfile,
  recomputeMyRoute,
  getTeamRoster,
  setCaptainZones,
  setCaptainHelper,
} = require('../controllers/trackingController');

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

// POST /api/tracking/rider-login
// Rider logs in with phone + password — issues a JWT with role: 'rider'.
router.post('/rider-login', riderLogin);

// ---------------------------------------------------------------------------
// User — live tracking map
// ---------------------------------------------------------------------------

// GET /api/tracking/active
// Returns today's assigned rider's live location and status.
// requireUserAccess: allows user, and admin/super_admin with a linked user account.
// Must be declared BEFORE /:id routes to avoid 'active' being matched as an id.
router.get('/active', verifyToken, requireUserAccess, getActiveRider);

// GET /api/tracking/eta
// Driving ETA from today's assigned rider to the calling user's address.
// Uses Google Distance Matrix + Geocoding on the backend.
router.get('/eta', verifyToken, requireUserAccess, getEta);

// ---------------------------------------------------------------------------
// Rider — delivery operations
// ---------------------------------------------------------------------------

// GET /api/tracking/delivery-list
// Returns today's confirmed delivery addresses for the CALLING rider
// (multi-rider aware — only their assigned PGs). Legacy fallback:
// returns the full deliverable list when no delivery_stops exist yet
// and the caller matches poll.assigned_rider_id.
// Must be declared BEFORE /:id routes.
router.get('/delivery-list', verifyToken, requireRole('rider'), getDeliveryList);

// GET /api/tracking/me — the calling rider's own live row.
// Literal segment, so it sits above any /:id route.
router.get('/me', verifyToken, requireRole('rider'), getMyRiderProfile);

// GET /api/tracking/my-stops
// The rider's own delivery stops for today's run, in optimized
// visit order (Google Directions waypoint optimization). Each stop
// carries its shared destination coord + packet count + status.
router.get('/my-stops', verifyToken, requireRole('rider'), getMyStops);

// POST /api/tracking/my-route/recompute
// Rider-triggered route recompute — called when they tap "Start
// delivery" so the optimized order reflects their live origin.
router.post('/my-route/recompute', verifyToken, requireRole('rider'), recomputeMyRoute);

// PATCH /api/tracking/stops/:id/mark-delivered
// Rider marks one of their own stops as delivered. Emits a
// stop_delivered socket event to every user at that PG.
router.patch('/stops/:id/mark-delivered', verifyToken, requireRole('rider'), markStopDelivered);

// PATCH /api/tracking/stops/:id/undo-delivered — rider only, own stops.
// Recovery from a mistap; see the controller for why there is no time limit.
router.patch('/stops/:id/undo-delivered', verifyToken, requireRole('rider'), undoStopDelivered);

// POST /api/tracking/delivery-run/assign
// Generate tonight's stops from the standing roster. Each PG goes to the
// captain who covers its zone, so two captains' runs are always disjoint.
// Body (optional): { captain_ids: [uuid, ...] } to narrow the run to the
// captains actually working tonight.
router.post('/delivery-run/assign', verifyToken, requireRole('super_admin'), assignDeliveryRun);

// ---------------------------------------------------------------------------
// Super admin — delivery team roster
//
// Standing configuration, not a nightly choice: who captains which zones,
// and who rides with them. The delivery run above is generated from it.
// Literal segments, so they sit above any /:id route.
// ---------------------------------------------------------------------------

// GET /api/tracking/teams — the full roster + uncovered zones + free riders.
router.get('/teams', verifyToken, requireRole('super_admin'), getTeamRoster);

// PUT /api/tracking/teams/:captainId/zones — replace a captain's zone set.
// Body: { zone_ids: [uuid, ...] }. 409 if a zone is another captain's.
router.put('/teams/:captainId/zones', verifyToken, requireRole('super_admin'), setCaptainZones);

// PUT /api/tracking/teams/:captainId/helper — set, swap, or remove a helper.
// Body: { helper_rider_id: uuid | null }
router.put('/teams/:captainId/helper', verifyToken, requireRole('super_admin'), setCaptainHelper);

// GET /api/tracking/delivery-run
// Super admin's view of today's run — every rider + their stops.
router.get('/delivery-run', verifyToken, requireRole('super_admin'), getDeliveryRun);

// PATCH /api/tracking/:id/push-location
// Rider pushes their live GPS every 5 seconds.
// Body: { latitude, longitude, current_address?, eta_minutes?, status? }
router.patch('/:id/push-location', verifyToken, requireRole('rider'), pushLocation);

// ---------------------------------------------------------------------------
// Super admin — rider management
// ---------------------------------------------------------------------------

// GET /api/tracking/all
// Full list of all riders with status and zone.
// Must be declared BEFORE /:id routes.
router.get('/all', verifyToken, requireRole('super_admin'), getAllRiders);

// POST /api/tracking
// Create a new rider.
// Body (Mode A — promote user): { user_id, zone_location_id?, password }
// Body (Mode B — standalone):   { name, phone, password, zone_location_id? }
router.post('/', verifyToken, requireRole('super_admin'), createRider);

// PATCH /api/tracking/unassign-today
// Clear today's rider assignment. No-arg (one assignment per day).
// Literal segment — MUST come before /:id/assign-today so Express
// doesn't match "unassign-today" as an :id UUID.
router.patch('/unassign-today', verifyToken, requireRole('super_admin'), unassignTodaysRider);

// PATCH /api/tracking/:id/assign-today
// Assign a rider to today's poll. Replaces any existing assignment.
router.patch('/:id/assign-today', verifyToken, requireRole('super_admin'), assignTodaysRider);

// PATCH /api/tracking/:id/toggle
// Enable or disable a rider (on-duty / off-duty).
// Automatically clears today's assignment if the rider is being deactivated.
router.patch('/:id/toggle', verifyToken, requireRole('super_admin'), toggleRider);

// PATCH /api/tracking/:id/location
// Manual location override for edge cases (GPS failure etc.).
// Body: { latitude, longitude, current_address?, eta_minutes? }
router.patch('/:id/location', verifyToken, requireRole('super_admin'), updateLocationManual);

// DELETE /api/tracking/:id
// Hard delete a rider. Clears today's assignment if they were assigned.
router.delete('/:id', verifyToken, requireRole('super_admin'), deleteRider);

module.exports = router;
