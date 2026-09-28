'use strict';

/**
 * cloudinaryService.js — thin wrapper around the Cloudinary SDK.
 *
 * All Cloudinary interaction goes through this module. If we ever
 * swap providers (S3, local disk, etc.) only this file changes.
 *
 * Config precedence:
 *   1. CLOUDINARY_URL (single-var, matches Cloudinary's own convention)
 *   2. CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET
 *
 * Uploads happen from a Buffer that multer keeps in memory — no
 * temporary file on disk, so the backend can be stateless.
 */

const { v2: cloudinary } = require('cloudinary');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

let configured = false;

const configure = () => {
  if (configured) return;

  if (process.env.CLOUDINARY_URL) {
    // The SDK auto-picks up CLOUDINARY_URL from process.env, but calling
    // .config() explicitly makes the intent obvious.
    cloudinary.config({ secure: true });
  } else if (
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  ) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure:     true,
    });
  } else {
    logger.warn('[cloudinary] Not configured — screenshot uploads will fail. Set CLOUDINARY_URL (or the split vars) in .env.');
  }

  configured = true;
};

/** True when the credentials are in place. Cheap enough to call per-request. */
const isConfigured = () =>
  Boolean(process.env.CLOUDINARY_URL) ||
  (process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET);

/**
 * Upload an image buffer to Cloudinary.
 *
 * @param {Buffer}  buffer         — raw file bytes (from multer memory storage)
 * @param {object}  opts
 * @param {string}  opts.folder    — Cloudinary folder, e.g. 'onemessage/donations'
 * @param {string=} opts.publicId  — optional deterministic id; leaves random otherwise
 * @returns {Promise<{ url: string, publicId: string, width: number, height: number, bytes: number }>}
 */
const uploadImage = async (buffer, { folder, publicId, type = 'upload' } = {}) => {
  if (!isConfigured()) {
    throw new AppError('Image storage is not configured on the server', 503);
  }
  if (!Buffer.isBuffer(buffer)) {
    throw new AppError('uploadImage requires a Buffer', 400);
  }
  configure();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: 'image',
        // 'authenticated' refuses unsigned requests; see screenshotViewUrl.
        type,
        overwrite: false,
        // Serve a moderately-compressed variant back — screenshots are
        // typically PNGs and we don't need pixel-perfect for review.
        transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
      },
      (err, result) => {
        if (err) {
          logger.warn(`[cloudinary] upload failed: ${err.message}`);
          return reject(new AppError('Could not save the screenshot. Try again.', 502));
        }
        return resolve({
          // For an authenticated asset this URL carries a permanent
          // signature — never store or return it; sign per request instead.
          url:      result.secure_url,
          publicId: result.public_id,
          format:   result.format,
          type:     result.type,
          width:    result.width,
          height:   result.height,
          bytes:    result.bytes,
        });
      }
    );
    uploadStream.end(buffer);
  });
};

/**
 * Delete an asset by publicId. Best-effort — logs and swallows errors.
 * Used when a controller needs to roll back an upload after a DB write fails.
 */
const deleteImage = async (publicId, { type = 'upload' } = {}) => {
  if (!publicId || !isConfigured()) return;
  configure();
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', type, invalidate: true });
  } catch (err) {
    logger.warn(`[cloudinary] delete failed for ${publicId}: ${err.message}`);
  }
};

/**
 * Extract a Cloudinary publicId from a secure URL. Used when the DB
 * only stored the URL (older rows) and we need to delete the asset.
 * Returns null if the URL doesn't look like ours.
 */
const publicIdFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i);
  return m ? m[1] : null;
};

// How long a screenshot link handed to the app stays valid. Screens refetch
// on focus, so an hour comfortably outlasts any real viewing.
const VIEW_LINK_TTL_SECONDS = 60 * 60;

/**
 * The URL the app should load for a donation's screenshot, or null.
 *
 * Authenticated assets get a signed download link that EXPIRES
 * (VIEW_LINK_TTL_SECONDS) — a copied or leaked link stops working. Legacy
 * public rows (not yet converted by scripts/secure-donation-screenshots.js)
 * return their stored URL, as before.
 */
const screenshotViewUrl = (donation) => {
  if (!donation) return null;
  if (donation.screenshot_access === 'authenticated' && donation.screenshot_public_id) {
    if (!isConfigured()) return null;
    configure();
    return cloudinary.utils.private_download_url(donation.screenshot_public_id, donation.screenshot_format || 'jpg', {
      type: 'authenticated',
      resource_type: 'image',
      attachment: false,
      expires_at: Math.floor(Date.now() / 1000) + VIEW_LINK_TTL_SECONDS,
    });
  }
  return donation.screenshot_url || null;
};

/** Delete a donation's screenshot, whichever delivery type it has. */
const deleteScreenshot = async (donation) => {
  if (!donation) return;
  const publicId = donation.screenshot_public_id || publicIdFromUrl(donation.screenshot_url);
  if (!publicId) return;
  await deleteImage(publicId, { type: donation.screenshot_access === 'authenticated' ? 'authenticated' : 'upload' });
};

module.exports = {
  uploadImage,
  deleteImage,
  deleteScreenshot,
  publicIdFromUrl,
  screenshotViewUrl,
  isConfigured,
  VIEW_LINK_TTL_SECONDS,
};
