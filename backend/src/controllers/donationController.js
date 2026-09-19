'use strict';

/**
 * donationController.js
 *
 * User-facing endpoints:
 *   POST /api/donations               submitDonation        (auth + multipart)
 *   GET  /api/donations/my            getMyHistory
 *
 * Super-admin-facing endpoints:
 *   GET   /api/admin/donations              listAll
 *   PATCH /api/admin/donations/:id/verify   verifyDonation
 *   PATCH /api/admin/donations/:id/reject   rejectDonation
 *   GET   /api/admin/donations/summary      getSummary
 *
 * Flow:
 *   1. User pays externally, uploads a screenshot via POST /api/donations.
 *   2. Row is created with status='pending', screenshot_url = Cloudinary URL.
 *   3. Super admin reviews via /admin/donations, verifies or rejects.
 *   4. Only 'verified' donations count toward the community total.
 *
 * Rollback: if the Cloudinary upload succeeds but the DB insert fails,
 * we delete the Cloudinary asset so nothing orphans.
 */

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const cloudinaryService = require('../services/cloudinaryService');
const logger = require('../utils/logger');

const { Donation, User, SuperAdmin } = db;

const MAX_AMOUNT = 9999999.99;
const CLOUDINARY_FOLDER = 'onemessage/donations';

// ---------------------------------------------------------------------------
// POST /api/donations
// Access: authenticated user (requireUserAccess populates req.actingUserId).
// Multipart: field 'screenshot' (image, ≤ 5 MB — enforced by upload middleware).
// Body:      amount (number, in INR), note? (string, optional).
// ---------------------------------------------------------------------------
const submitDonation = async (req, res, next) => {
  let uploaded = null; // { url, publicId } — kept so we can roll back on DB failure

  try {
    const { amount, note } = req.body;

    // 1. Validate the amount before we do anything expensive.
    const parsed = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
      return error(res, { statusCode: 400, message: 'Enter an amount greater than zero.' });
    }
    if (parsed > MAX_AMOUNT) {
      return error(res, {
        statusCode: 400,
        message: `Amount must not exceed ₹${MAX_AMOUNT.toLocaleString('en-IN')}.`,
      });
    }

    // 2. Require the screenshot. Multer put it on req.file if present.
    if (!req.file || !req.file.buffer) {
      return error(res, { statusCode: 400, message: 'Attach a payment screenshot before submitting.' });
    }

    // 3. Upload the screenshot to Cloudinary FIRST — if this fails, no
    //    DB row is created and no partial state exists.
    uploaded = await cloudinaryService.uploadImage(req.file.buffer, {
      folder: CLOUDINARY_FOLDER,
    });

    // 4. Create the pending donation row.
    const rounded = Math.round(parsed * 100) / 100;
    const donation = await Donation.create({
      user_id: req.actingUserId,
      amount: rounded,
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null,
      screenshot_url: uploaded.url,
      status: 'pending',
    });

    return success(res, {
      statusCode: 201,
      message: 'Your donation has been submitted. A super admin will verify it shortly.',
      data: {
        id: donation.id,
        amount: donation.amount,
        status: donation.status,
        screenshot_url: donation.screenshot_url,
        created_at: donation.created_at,
      },
    });
  } catch (err) {
    // If we uploaded a screenshot but never persisted the row, remove it.
    if (uploaded?.publicId) {
      await cloudinaryService.deleteImage(uploaded.publicId);
    }
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/donations/my
// Access: authenticated user.
// Returns the caller's own donation history, newest first.
// Query: ?page=1&limit=20&status=pending|verified|rejected
// ---------------------------------------------------------------------------
const getMyHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = { user_id: req.actingUserId };
    if (['pending', 'verified', 'rejected'].includes(req.query.status)) {
      where.status = req.query.status;
    }

    const { count, rows } = await Donation.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      attributes: [
        'id', 'amount', 'note', 'screenshot_url', 'status',
        'rejection_reason', 'verified_at', 'created_at',
      ],
    });

    return success(res, {
      statusCode: 200,
      message: 'Donation history fetched.',
      data: { total: count, page, limit, donations: rows },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/admin/donations
// Access: super_admin.
// Query: ?page=1&limit=20&status=pending|verified|rejected
// Newest-first paginated list with donor identity + screenshot URL.
// ---------------------------------------------------------------------------
const listAll = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = {};
    if (['pending', 'verified', 'rejected'].includes(req.query.status)) {
      where.status = req.query.status;
    }

    const { count, rows } = await Donation.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'address'],
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return success(res, {
      statusCode: 200,
      message: 'Donations fetched.',
      data: { total: count, page, limit, donations: rows },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/admin/donations/:id/verify
// Access: super_admin.
// Moves a pending donation to 'verified'. Idempotent-friendly: 409 if
// the donation is already in a terminal state.
// ---------------------------------------------------------------------------
const verifyDonation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const donation = await Donation.findByPk(id);

    if (!donation) {
      return error(res, { statusCode: 404, message: 'Donation not found.' });
    }
    if (donation.status !== 'pending') {
      return error(res, {
        statusCode: 409,
        message: `This donation was already ${donation.status}.`,
      });
    }

    donation.status = 'verified';
    donation.verified_by = req.auth.id; // super_admin.id
    donation.verified_at = new Date();
    donation.rejection_reason = null; // clear any leftover, defensive
    await donation.save();

    return success(res, {
      statusCode: 200,
      message: 'Donation verified.',
      data: {
        id: donation.id,
        status: donation.status,
        verified_at: donation.verified_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/admin/donations/:id/reject
// Access: super_admin.
// Body: { reason?: string }  — optional short explanation shown to the user.
// ---------------------------------------------------------------------------
const rejectDonation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (reason !== undefined && reason !== null) {
      if (typeof reason !== 'string') {
        return error(res, { statusCode: 400, message: 'reason must be a string.' });
      }
      if (reason.length > 500) {
        return error(res, { statusCode: 400, message: 'reason must be 500 characters or fewer.' });
      }
    }

    const donation = await Donation.findByPk(id);
    if (!donation) {
      return error(res, { statusCode: 404, message: 'Donation not found.' });
    }
    if (donation.status !== 'pending') {
      return error(res, {
        statusCode: 409,
        message: `This donation was already ${donation.status}.`,
      });
    }

    donation.status = 'rejected';
    donation.rejection_reason = (typeof reason === 'string' && reason.trim()) ? reason.trim() : null;
    donation.verified_by = req.auth.id;
    donation.verified_at = new Date();
    await donation.save();

    return success(res, {
      statusCode: 200,
      message: 'Donation rejected.',
      data: {
        id: donation.id,
        status: donation.status,
        rejection_reason: donation.rejection_reason,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/admin/donations/summary
// Access: super_admin.
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD  (both optional)
// Returns totals + counts per status.
// ---------------------------------------------------------------------------
const getSummary = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = {};
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(`${from}T00:00:00.000Z`);
      if (to)   where.created_at[Op.lte] = new Date(`${to}T23:59:59.999Z`);
    }

    const rows = await Donation.findAll({
      where,
      attributes: ['status', 'amount'],
      raw: true,
    });

    const summary = {
      total_amount:    0,   // sum of verified — real money in
      pending_amount:  0,
      rejected_amount: 0,
      counts: { pending: 0, verified: 0, rejected: 0 },
      total_count: rows.length,
    };

    for (const r of rows) {
      const amt = Number.parseFloat(r.amount) || 0;
      if (summary.counts[r.status] !== undefined) summary.counts[r.status] += 1;
      if (r.status === 'verified')      summary.total_amount    += amt;
      else if (r.status === 'pending')  summary.pending_amount  += amt;
      else if (r.status === 'rejected') summary.rejected_amount += amt;
    }

    // Clean 2-decimal rounding for the response.
    summary.total_amount    = Math.round(summary.total_amount    * 100) / 100;
    summary.pending_amount  = Math.round(summary.pending_amount  * 100) / 100;
    summary.rejected_amount = Math.round(summary.rejected_amount * 100) / 100;

    return success(res, {
      statusCode: 200,
      message: 'Donation summary fetched.',
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitDonation,
  getMyHistory,
  listAll,
  verifyDonation,
  rejectDonation,
  getSummary,
};
