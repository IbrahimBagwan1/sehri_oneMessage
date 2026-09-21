'use strict';

const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  getLocations,
  getLocationsNeedingCoordinates,
  listAllAddresses,
  setCoordinates,
  createAddress,
  updateAddress,
  deleteAddress,
} = require('../controllers/locationController');

const router = express.Router();

// ---------------------------------------------------------------------------
// Route order — literal segments FIRST, /:id routes LAST. Also note the
// two-tier PATCH split: PATCH /:id/coordinates (pin only) is a distinct
// endpoint from PATCH /:id (rename + reparent) so the two contracts stay
// narrow and validation stays simple. Express matches top-to-bottom so
// `/:id/coordinates` must come before the shorter `/:id`.
// ---------------------------------------------------------------------------

// GET /api/locations — PUBLIC (registration screen needs it before auth).
router.get('/', getLocations);

// GET /api/locations/needs-coordinates — super_admin only.
router.get('/needs-coordinates', verifyToken, requireRole('super_admin'), getLocationsNeedingCoordinates);

// GET /api/locations/addresses — super_admin only. Full list w/ pin state.
router.get('/addresses', verifyToken, requireRole('super_admin'), listAllAddresses);

// POST /api/locations/address — super_admin only. Create a new PG.
// Body: { name, parent_id (zone), latitude?, longitude? }
router.post('/address', verifyToken, requireRole('super_admin'), createAddress);

// PATCH /api/locations/:id/coordinates — super_admin only. Body: { latitude, longitude }
// Kept as its own endpoint (used by the map picker) so the pin flow is unambiguous.
router.patch('/:id/coordinates', verifyToken, requireRole('super_admin'), setCoordinates);

// PATCH /api/locations/:id — super_admin only. Rename + reparent.
// Body: { name?, parent_id? }
router.patch('/:id', verifyToken, requireRole('super_admin'), updateAddress);

// DELETE /api/locations/:id — super_admin only. Soft-deletes an address.
// Query: ?force=true bypasses the linked-users guard (see controller).
router.delete('/:id', verifyToken, requireRole('super_admin'), deleteAddress);

module.exports = router;
