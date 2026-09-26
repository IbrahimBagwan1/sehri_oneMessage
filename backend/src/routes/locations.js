'use strict';

const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  getLocations,
  getLocationsNeedingCoordinates,
  listAllAddresses,
  setCoordinates,
  createLocation,
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

// POST /api/locations — super_admin only. Create at ANY level of the tree.
// Body: { name, type: city|region|area|zone|address, parent_id?, latitude?, longitude? }
// Creating a zone also assigns its zone_key and provisions its chat group.
router.post('/', verifyToken, requireRole('super_admin'), createLocation);

// POST /api/locations/address — super_admin only. Create a new PG.
// Kept as its own route: the app's PG screen posts here and speaks PG terms.
// Body: { name, parent_id (zone), latitude?, longitude? }
router.post('/address', verifyToken, requireRole('super_admin'), createAddress);

// PATCH /api/locations/:id/coordinates — super_admin only. Body: { latitude, longitude }
// Kept as its own endpoint (used by the map picker) so the pin flow is unambiguous.
router.patch('/:id/coordinates', verifyToken, requireRole('super_admin'), setCoordinates);

// PATCH /api/locations/:id — super_admin only. Rename + reparent, any level.
// Body: { name?, parent_id? }  — a zone's zone_key is never rewritten.
router.patch('/:id', verifyToken, requireRole('super_admin'), updateAddress);

// DELETE /api/locations/:id — super_admin only. Soft-deletes any level.
// Refuses while active children or linked users remain; ?force=true overrides.
// Removing a zone also closes its group chat.
router.delete('/:id', verifyToken, requireRole('super_admin'), deleteAddress);

module.exports = router;
