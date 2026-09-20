'use strict';

const express = require('express');
const { verifyToken, requireRole } = require('../middleware/auth');
const {
  getLocations,
  getLocationsNeedingCoordinates,
  listAllAddresses,
  setCoordinates,
} = require('../controllers/locationController');

const router = express.Router();

// Route order — literal segments first, /:id last.

// GET /api/locations — PUBLIC (registration screen needs it before auth).
router.get('/', getLocations);

// GET /api/locations/needs-coordinates — super_admin only.
router.get('/needs-coordinates', verifyToken, requireRole('super_admin'), getLocationsNeedingCoordinates);

// GET /api/locations/addresses — super_admin only. Full list w/ pin state.
router.get('/addresses', verifyToken, requireRole('super_admin'), listAllAddresses);

// PATCH /api/locations/:id/coordinates — super_admin only. Body: { latitude, longitude }
router.patch('/:id/coordinates', verifyToken, requireRole('super_admin'), setCoordinates);

module.exports = router;
