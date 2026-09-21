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
const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

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

/**
 * Decode a Google-encoded polyline5 string into an array of
 * [latitude, longitude] pairs. Implements the standard algorithm
 * described at https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 *
 * Pure JS, no npm dependency. Kept co-located with the Directions call so
 * the frontend can consume plain [lat, lng] arrays that drop straight into
 * Leaflet without any decoding step.
 */
const decodePolyline5 = (encoded) => {
  if (typeof encoded !== 'string' || encoded.length === 0) return [];
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dLat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dLng;

    points.push([lat * 1e-5, lng * 1e-5]);
  }
  return points;
};

/**
 * Fetch a driving route via the Google Directions API.
 *
 * Simple case (origin → destination):
 *   directions({ origin, destination })
 *   Returns { path, distanceMeters, durationSeconds, distanceText, durationText, waypointOrder: [], legs: [{...}] }
 *
 * Multi-stop case (origin → [waypoints...] → destination):
 *   directions({ origin, destination, waypoints, optimizeWaypoints: true })
 *   Returns the same shape PLUS `waypointOrder` — an array of indices
 *   into the input `waypoints` array in Google's optimized visit order,
 *   and `legs` — one leg per hop (origin→wp0, wp0→wp1, …, wpN→destination)
 *   each with its own distance/duration. Rider UI uses the legs to
 *   compute per-stop distance / eta and waypointOrder to sort the stops.
 *
 * Never throws — returns null on any failure so callers can degrade.
 */
const directions = async ({
  origin,
  destination,
  waypoints = [],
  optimizeWaypoints = false,
  mode = 'driving',
}) => {
  const apiKey = getApiKey();
  if (!apiKey || !origin || !destination) return null;

  const params = {
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    mode,
    units: 'metric',
    key: apiKey,
  };
  if (Array.isArray(waypoints) && waypoints.length > 0) {
    // Google waypoint syntax: "optimize:true|lat,lng|lat,lng|..."
    const prefix = optimizeWaypoints ? 'optimize:true|' : '';
    params.waypoints = prefix + waypoints.map((w) => `${w.lat},${w.lng}`).join('|');
  }

  try {
    const { data } = await axios.get(DIRECTIONS_URL, {
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });

    if (data.status !== 'OK' || !Array.isArray(data.routes) || data.routes.length === 0) {
      logger.warn(`[googleMaps] directions returned status=${data.status}`);
      return null;
    }

    const route = data.routes[0];
    const encoded = route.overview_polyline?.points || '';
    const path = decodePolyline5(encoded);

    if (path.length < 2) {
      logger.warn('[googleMaps] directions returned an empty polyline');
      return null;
    }

    // Multi-leg routes: total distance/duration is the sum. For the
    // single-leg case this collapses to the leg's own values.
    const legs = Array.isArray(route.legs) ? route.legs : [];
    const distanceMeters = legs.reduce((s, l) => s + (l.distance?.value || 0), 0) || null;
    const durationSeconds = legs.reduce((s, l) => s + (l.duration?.value || 0), 0) || null;

    return {
      path,
      distanceMeters,
      durationSeconds,
      distanceText:    legs[0]?.distance?.text ?? null,
      durationText:    legs[0]?.duration?.text ?? null,
      waypointOrder:   Array.isArray(route.waypoint_order) ? route.waypoint_order : [],
      legs: legs.map((l) => ({
        distanceMeters:  l.distance?.value ?? null,
        durationSeconds: l.duration?.value ?? null,
        distanceText:    l.distance?.text ?? null,
        durationText:    l.duration?.text ?? null,
      })),
    };
  } catch (err) {
    logger.warn(`[googleMaps] directions failed: ${err.message}`);
    return null;
  }
};

module.exports = {
  isConfigured,
  reverseGeocode,
  geocode,
  distanceMatrix,
  directions,
};
