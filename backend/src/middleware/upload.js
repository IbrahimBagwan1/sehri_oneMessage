'use strict';

/**
 * upload.js — multer factory for in-memory image uploads.
 *
 * The buffer never touches disk. Controllers hand it off to
 * cloudinaryService.uploadImage() directly.
 *
 * Constraints:
 *   • image/* MIME types only (jpg, png, webp, heic)
 *   • 5 MB per file — enough for a payment-app screenshot at native res
 *   • one file per request
 *
 * Usage:
 *   const upload = require('../middleware/upload');
 *   router.post('/donations', verifyToken, upload.single('screenshot'), submit);
 *
 * A multer error is caught by the global error handler and turned into
 * a friendly response via `handleMulterError`.
 */

const multer = require('multer');
const AppError = require('../utils/appError');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return cb(new AppError('Only image files are allowed.', 415), false);
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_BYTES, files: 1 },
});

/**
 * Wraps upload.single() so a MulterError becomes a clean AppError that
 * the global error handler already knows how to respond to.
 */
const singleImage = (fieldName) => (req, res, next) => {
  upload.single(fieldName)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(`Image is too large. Max ${MAX_BYTES / (1024 * 1024)} MB.`, 413));
      }
      return next(new AppError(`Upload error: ${err.message}`, 400));
    }
    return next(err);
  });
};

module.exports = { upload, singleImage, MAX_BYTES };
