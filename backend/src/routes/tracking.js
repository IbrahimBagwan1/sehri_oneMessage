'use strict';
const express = require('express');
const router = express.Router();
const { verifyToken, requireRole, requireUserAccess } = require('../middleware/auth');
const {
  riderLogin,
  createRider,
  getAllRiders,
  assignTodaysRider,
  toggleRider,
  updateLocationManual,
  pushLocation,
  getActiveRider,
  getDeliveryList,
  deleteRider,
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

// ---------------------------------------------------------------------------
// Rider — delivery operations
// ---------------------------------------------------------------------------

// GET /api/tracking/delivery-list
// Returns today's confirmed delivery addresses.
// Only accessible by the rider assigned to today's poll.
// Must be declared BEFORE /:id routes.
router.get('/delivery-list', verifyToken, requireRole('rider'), getDeliveryList);

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
