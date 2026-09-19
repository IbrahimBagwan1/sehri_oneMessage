'use strict';

/**
 * donationController.js
 *
 * Endpoints:
 *   POST  /api/donations/submit           submitDonation      (user)
 *   GET   /api/donations/history          getMyHistory        (user)
 *   GET   /api/donations/all              getAllDonations     (admin zone-scoped, super_admin all)
 *   GET   /api/donations/summary          getDonationSummary  (admin zone-scoped, super_admin all)
 *   PATCH /api/donations/:id/status       updateStatus        (admin zone-scoped, super_admin any)
 *
 * Zone scoping mirrors the pattern used across the codebase:
 *  • Eager-load user + full location chain in one JOIN.
 *  • Walk the chain in memory (resolveZoneFromLoaded) to find the zone.
 *  • Admin sees only donations whose donor resolves to their zone.
 *
 * Amounts are stored + returned as DECIMAL(10,2) so no FP rounding.
 * The frontend sends amount as a string or number; we cast + validate here.
 */

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const {
  buildLocationInclude,
  resolveZoneFromLoaded,
} = require('../utils/zoneScope');

const { Donation, User, Admin, SuperAdmin } = db;

const MAX_AMOUNT = 9999999.99;

// ---------------------------------------------------------------------------
// Helper — resolve the admin.id of the reviewing caller.
//
// Verified_by must reference an admins.id (per the schema). When a
// super_admin reviews, we still need to record who did it. If they have
// a linked admin row we use that; otherwise we record their super_admin.id
// and let the shape of the id imply the source table.
// ---------------------------------------------------------------------------
const resolveVerifierId = (auth) => {
  // Both admin and super_admin carry their table PK as `id` in the JWT.
  // We keep it simple: whichever role acted, that id goes in verified_by.
  return auth.id;
};

// ---------------------------------------------------------------------------
// POST /api/donations/submit
// Access: requireUserAccess (user, or admin/super_admin with linked user)
// Body: { amount: number|string, note?: string }
//
// Creates a pending donation record. Admin verification happens later.
// ---------------------------------------------------------------------------
const submitDonation = async (req, res, next) => {
  try {
    const { amount, note } = req.body;

    const parsed = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
      return error(res, {
        statusCode: 400,
        message: 'amount must be a positive number (in INR)',
      });
    }
    if (parsed > MAX_AMOUNT) {
      return error(res, {
        statusCode: 400,
        message: `amount must not exceed ₹${MAX_AMOUNT.toLocaleString('en-IN')}`,
      });
    }

    if (note !== undefined && note !== null && typeof note !== 'string') {
      return error(res, { statusCode: 400, message: 'note must be a string' });
    }
    if (typeof note === 'string' && note.length > 500) {
      return error(res, { statusCode: 400, message: 'note must be 500 characters or fewer' });
    }

    // Round to paise so DECIMAL(10,2) stores exactly what the client sees.
    const rounded = Math.round(parsed * 100) / 100;

    const donation = await Donation.create({
      user_id: req.actingUserId,
      amount: rounded,
      note: note?.trim() || null,
      status: 'pending',
    });

    return success(res, {
      statusCode: 201,
      message: 'Donation submitted. Awaiting admin verification.',
      data: {
        id: donation.id,
        amount: donation.amount,
        note: donation.note,
        status: donation.status,
        created_at: donation.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/donations/history
// Access: requireUserAccess (calling user's own donations)
// Query: ?page=1&limit=20&status=pending|verified|rejected
// ---------------------------------------------------------------------------
const getMyHistory = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = { user_id: req.actingUserId };
    if (req.query.status && ['pending', 'verified', 'rejected'].includes(req.query.status)) {
      where.status = req.query.status;
    }

    const { count, rows } = await Donation.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    return success(res, {
      statusCode: 200,
      message: 'Donation history fetched',
      data: {
        total: count,
        page,
        limit,
        donations: rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/donations/all
// Access: admin (own zone), super_admin (all zones)
// Query: ?page=1&limit=20&status=pending|verified|rejected
//
// Zone-scoping is done in memory after eager-loading user.location chain.
// We deliberately fetch a page-sized slice and filter after — the number of
// donations per day is small enough that this is fine. If volume grows we
// can push the zone filter into a raw SQL JOIN later.
// ---------------------------------------------------------------------------
const getAllDonations = async (req, res, next) => {
  try {
    const { role, zone_location_id } = req.auth;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = {};
    if (req.query.status && ['pending', 'verified', 'rejected'].includes(req.query.status)) {
      where.status = req.query.status;
    }

    const { count, rows } = await Donation.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'address'],
          include: [buildLocationInclude()],
        },
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    let visible = rows;
    if (role === 'admin') {
      visible = rows.filter((d) => {
        const zone = resolveZoneFromLoaded(d.user?.location);
        return zone && zone.id === zone_location_id;
      });
    }

    return success(res, {
      statusCode: 200,
      message: 'Donations fetched',
      data: {
        total: count,       // total before zone-filter (used for pagination hints)
        page,
        limit,
        donations: visible,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/donations/summary
// Access: admin (own zone), super_admin (all zones)
// Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD  (both optional)
//
// Returns totals + counts grouped by status. The frontend renders a
// dashboard card ("₹XX,XXX collected · N pending · M verified").
// ---------------------------------------------------------------------------
const getDonationSummary = async (req, res, next) => {
  try {
    const { role, zone_location_id } = req.auth;
    const { from, to } = req.query;

    const where = {};
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(`${from}T00:00:00.000Z`);
      if (to) where.created_at[Op.lte] = new Date(`${to}T23:59:59.999Z`);
    }

    // Pull all matching rows with the user chain so we can zone-filter.
    // The volume here is bounded by the (from,to) range — for admin
    // dashboards this is fine.
    const rows = await Donation.findAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone'],
          include: [buildLocationInclude()],
        },
      ],
    });

    let visible = rows;
    if (role === 'admin') {
      visible = rows.filter((d) => {
        const zone = resolveZoneFromLoaded(d.user?.location);
        return zone && zone.id === zone_location_id;
      });
    }

    const summary = {
      total_amount: 0,          // sum of verified only — real money in
      pending_amount: 0,
      rejected_amount: 0,
      counts: { pending: 0, verified: 0, rejected: 0 },
      total_count: visible.length,
    };

    for (const d of visible) {
      const amt = Number.parseFloat(d.amount);
      summary.counts[d.status] += 1;
      if (d.status === 'verified') summary.total_amount += amt;
      else if (d.status === 'pending') summary.pending_amount += amt;
      else if (d.status === 'rejected') summary.rejected_amount += amt;
    }

    // Round back to paise so the response has clean 2-decimal numbers.
    summary.total_amount = Math.round(summary.total_amount * 100) / 100;
    summary.pending_amount = Math.round(summary.pending_amount * 100) / 100;
    summary.rejected_amount = Math.round(summary.rejected_amount * 100) / 100;

    return success(res, {
      statusCode: 200,
      message: 'Donation summary fetched',
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/donations/:id/status
// Access: admin (own zone), super_admin (any)
// Body: { status: 'verified' | 'rejected' }
//
// Verifier's id + timestamp are recorded on the donation row. A donation
// can only be moved out of 'pending' once — idempotent re-transitions are
// rejected with 409.
// ---------------------------------------------------------------------------
const updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const { role, zone_location_id } = req.auth;

    if (!['verified', 'rejected'].includes(status)) {
      return error(res, {
        statusCode: 400,
        message: "status must be 'verified' or 'rejected'",
      });
    }

    const donation = await Donation.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone'],
          include: [buildLocationInclude()],
        },
      ],
    });

    if (!donation) {
      return error(res, { statusCode: 404, message: 'Donation not found' });
    }

    if (donation.status !== 'pending') {
      return error(res, {
        statusCode: 409,
        message: `This donation has already been ${donation.status}`,
      });
    }

    // Admin zone check — must be same zone as the donor.
    if (role === 'admin') {
      const zone = resolveZoneFromLoaded(donation.user?.location);
      if (!zone || zone.id !== zone_location_id) {
        return error(res, {
          statusCode: 403,
          message: 'You can only verify donations from your own zone',
        });
      }
    }

    donation.status = status;
    donation.verified_by = resolveVerifierId(req.auth);
    donation.verified_at = new Date();
    await donation.save();

    return success(res, {
      statusCode: 200,
      message: `Donation ${status}`,
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

module.exports = {
  submitDonation,
  getMyHistory,
  getAllDonations,
  getDonationSummary,
  updateStatus,
};
