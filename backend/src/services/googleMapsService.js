'use strict';

/**
 * googleMapsService.js — thin wrapper around the Google Maps HTTP APIs.
 *
 * Uses the existing axios dependency; no new npm packages.
 *
 * Exposed helpers:
 *   • reverseGeocode({ lat, lng })          → human-readable address string
 *   • geocode(address)                       → { lat, lng } or null
 *   • distanceMatrix({ origin, destination }) → { distanceMeters, durationSeconds }
 *
 * All helpers swallow errors and return null / throw AppError so callers
 * can degrade gracefully. Reverse-geocode fires from the rider hot-path
 * (every 5s), so it must never throw or the location update fails.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

const REQUEST_TIMEOUT_MS = 6000;

const getApiKey = () => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    // Fail loud in dev so misconfiguration is obvious; controllers should
    // check isConfigured() before calling.
    logger.warn('[googleMaps] GOOGLE_MAPS_API_KEY is not set — maps calls will fail');
  }
  return key;
};

/** True when the key is configured. Cheap check callers can gate on. */
const isConfigured = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

/**
 * Reverse-geocode lat/lng → formatted address string.
 * Returns null on any failure (never throws) so it can be called from
 * hot paths without risking the parent request.
 */
const reverseGeocode = async ({ lat, lng }) => {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const { data } = await axios.get(GEOCODE_URL, {
      params: { latlng: `${lat},${lng}`, key: apiKey },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      logger.warn(`[googleMaps] reverseGeocode returned status=${data.status}`);
      return null;
    }

    return data.results[0].formatted_address || null;
  } catch (err) {
    logger.warn(`[googleMaps] reverseGeocode failed: ${err.message}`);
    return null;
  }
};

/**
 * Geocode a free-text address → { lat, lng }.
 * Returns null on failure. Used by the ETA endpoint to convert the calling
 * user's address into coordinates for the distance-matrix call.
 */
const geocode = async (address) => {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  if (!address || typeof address !== 'string') return null;

  try {
    const { data } = await axios.get(GEOCODE_URL, {
      params: { address, key: apiKey },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      logger.warn(`[googleMaps] geocode returned status=${data.status} for address="${address}"`);
      return null;
    }

    const loc = data.results[0].geometry?.location;
    if (!loc) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch (err) {
    logger.warn(`[googleMaps] geocode failed: ${err.message}`);
    return null;
  }
};

/**
 * Compute driving distance + duration between origin and destination.
 * Both inputs are { lat, lng } objects. Returns
 *   { distanceMeters, durationSeconds, distanceText, durationText }
 * or throws AppError so the /eta endpoint can respond with a real error.
 */
const distanceMatrix = async ({ origin, destination, mode = 'driving' }) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new AppError('Maps service is not configured on the server', 503);
  }
  if (!origin || !destination) {
    throw new AppError('origin and destination are required', 400);
  }

  try {
    const { data } = await axios.get(DISTANCE_MATRIX_URL, {
      params: {
        origins: `${origin.lat},${origin.lng}`,
        destinations: `${destination.lat},${destination.lng}`,
        mode,
        units: 'metric',
        key: apiKey,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (data.status !== 'OK') {
      throw new AppError(`Distance Matrix returned status=${data.status}`, 502);
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      throw new AppError('No route found between the two points', 404);
    }

    return {
      distanceMeters: element.distance?.value ?? null,
      durationSeconds: element.duration?.value ?? null,
      distanceText: element.distance?.text ?? null,
      durationText: element.duration?.text ?? null,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn(`[googleMaps] distanceMatrix failed: ${err.message}`);
    throw new AppError('Failed to compute ETA', 502);
  }
};

module.exports = {
  isConfigured,
  reverseGeocode,
  geocode,
  distanceMatrix,
};
