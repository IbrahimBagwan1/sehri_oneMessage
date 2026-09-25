'use strict';

/**
 * pollController2.js — Person 2 handlers
 *
 * Endpoints covered:
 *   POST  /api/polls/:id/special-case         submitSpecialCase
 *   POST  /api/polls/:id/special-case/undo    undoSpecialCase
 *   GET   /api/polls/special-cases            getSpecialCases
 *   POST  /api/polls/special-cases/allot      allotSpecialCases
 *   PATCH /api/polls/active/toggle            togglePoll
 *   GET   /api/polls/history                  getPollHistory
 *   GET   /api/polls/date/:date/stats         getDateStats
 *
 * Conventions (must match pollController.js):
 *   - 'use strict' at top
 *   - Models via:  const { Poll, PollResponse, User } = db;
 *   - Responses via:  success(res, {...}) / error(res, {...})
 *   - Every handler is async (req, res, next) with try/catch → next(err)
 *   - req.auth.id        = caller's own table PK
 *   - req.auth.role      = 'user' | 'admin' | 'super_admin'
 *   - req.actingUserId   = users.id (set by requireUserAccess middleware)
 *   - getNow()           = the only way to get the current timestamp
 */

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { VALID_ZONES } = require('../constants/zones');
const { describeMember } = require('../utils/memberDisplay');
const { resolveZone } = require('../utils/resolveZone');
const {
  getPollPhase,
  isSpecialCaseWindowOpen,
  isAllotmentWindowOpen,
  getNow,
} = require('../utils/pollPhase');

// Import the shared helper exported by Person 1.
// getTodaysPoll() returns the Poll row whose `date` equals today's IST date,
// or null if no poll has been created yet.
const { getTodaysPoll } = require('./pollController');

const { Poll, PollResponse, User } = db;

// ---------------------------------------------------------------------------
// Shared zone aggregation helper — reused by getActiveStats and getDateStats.
//
// Given a poll id (and optionally a single zone key to filter by), returns:
//   { by_zone: { masjid: { yes, no, total }, ... }, grand_total: { yes, no, total } }
//
// When `onlyZone` is passed, only that zone's row appears in by_zone and
// the grand_total only counts that zone — this is how getActiveStats /
// getDateStats keep zone admins from seeing other zones' totals.
// ---------------------------------------------------------------------------
const buildZoneStats = async (pollId, onlyZone = null) => {
  const { sequelize } = db;

  const allowedZones = onlyZone ? [onlyZone] : VALID_ZONES;
  const where = { poll_id: pollId };
  if (onlyZone) where.zone = onlyZone;

  const rows = await PollResponse.findAll({
    where,
    attributes: [
      'zone',
      'response',
      [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
    ],
    group: ['zone', 'response'],
    raw: true,
  });

  // Seed every zone with zeroes so the response shape is always consistent
  // regardless of whether anyone voted from a given zone.
  const byZone = Object.fromEntries(
    allowedZones.map((z) => [z, { yes: 0, no: 0, total: 0 }])
  );

  for (const row of rows) {
    if (byZone[row.zone]) {
      byZone[row.zone][row.response] = parseInt(row.count, 10);
    }
  }

  for (const zone of allowedZones) {
    byZone[zone].total = byZone[zone].yes + byZone[zone].no;
  }

  const grandTotal = {
    yes:   allowedZones.reduce((s, z) => s + byZone[z].yes, 0),
    no:    allowedZones.reduce((s, z) => s + byZone[z].no, 0),
    total: allowedZones.reduce((s, z) => s + byZone[z].total, 0),
  };

  return { by_zone: byZone, grand_total: grandTotal };
};

// ---------------------------------------------------------------------------
// Resolve the calling admin's zone-name key (masjid/boys_hostel/…), or
// null for super_admin. Mirrors the pattern in pollController.getActiveStats
// and getZoneVoters. Returns { zoneName: string|null, error: {status,message}|null }
// so callers can early-out cleanly.
// ---------------------------------------------------------------------------
const resolveAdminZoneName = async (req) => {
  if (req.auth.role !== 'admin') return { zoneName: null, error: null };
  const zoneLocation = await resolveZone(req.auth.zone_location_id, db);
  if (!zoneLocation) {
    return { zoneName: null, error: { status: 422, message: 'Could not resolve your admin zone' } };
  }
  const name = zoneLocation.name.toLowerCase().replace(/\s+/g, '_');
  if (!VALID_ZONES.includes(name)) {
    return { zoneName: null, error: { status: 422, message: `Your admin zone '${name}' is not a recognised delivery zone` } };
  }
  return { zoneName: name, error: null };
};

// ---------------------------------------------------------------------------
// POST /api/polls/:id/special-case
// Access: user (via requireUserAccess)
// Window: SPECIAL_CASE only (10 AM – 5 PM IST)
//
// Allows a user who already voted to flag that their plans changed:
//   type 'want'      — they voted 'no' but now want food
//   type 'dont_want' — they voted 'yes' but no longer want food
//
// Rules:
//   1. Window must be SPECIAL_CASE.
//   2. User must have a PollResponse row for this poll (they must have voted).
//   3. 'want'      is only valid when their original response was 'no'.
//      'dont_want' is only valid when their original response was 'yes'.
//   4. Cannot raise a second special case if one is already active (409).
//   5. Mutates the existing row — does NOT create a new one.
// ---------------------------------------------------------------------------
const submitSpecialCase = async (req, res, next) => {
  try {
    const { id: pollId } = req.params;
    const { type } = req.body;

    // 1. Load the poll
    const poll = await Poll.findByPk(pollId);
    if (!poll) {
      return error(res, { statusCode: 404, message: 'Poll not found' });
    }

    // 2. Window check
    if (!isSpecialCaseWindowOpen(poll)) {
      return error(res, {
        statusCode: 403,
        message: 'Special case window is not open (10 AM – 5 PM only)',
      });
    }

    // 3. User must have voted
    const pollResponse = await PollResponse.findOne({
      where: { poll_id: pollId, user_id: req.actingUserId },
    });
    if (!pollResponse) {
      return error(res, {
        statusCode: 404,
        message: 'You have not voted on this poll yet',
      });
    }

    // 4. Duplicate guard — can't raise a second active special case
    if (pollResponse.is_special_case) {
      return error(res, {
        statusCode: 409,
        message: 'You already have an active special case for this poll',
      });
    }

    // 5. Cross-check type vs original vote
    if (type === 'want' && pollResponse.response !== 'no') {
      return error(res, {
        statusCode: 422,
        message: "'want' is only valid when your original vote was 'no'",
      });
    }
    if (type === 'dont_want' && pollResponse.response !== 'yes') {
      return error(res, {
        statusCode: 422,
        message: "'dont_want' is only valid when your original vote was 'yes'",
      });
    }

    // 6. Mutate the existing row — one row per user per poll, always.
    await pollResponse.update({
      is_special_case: true,
      special_case_type: type,
      special_case_at: getNow(),
    });

    return success(res, {
      statusCode: 200,
      message: 'Special case submitted',
      data: {
        response_id: pollResponse.id,
        special_case_type: type,
        original_response: pollResponse.response,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/polls/:id/special-case/undo
// Access: user (via requireUserAccess)
// Window: SPECIAL_CASE only
//
// Lets a user retract their special case — but only if the super admin
// has not reviewed it yet (sehri_allowed is still null).
// ---------------------------------------------------------------------------
const undoSpecialCase = async (req, res, next) => {
  try {
    const { id: pollId } = req.params;

    // 1. Load the poll
    const poll = await Poll.findByPk(pollId);
    if (!poll) {
      return error(res, { statusCode: 404, message: 'Poll not found' });
    }

    // 2. Window check
    if (!isSpecialCaseWindowOpen(poll)) {
      return error(res, {
        statusCode: 403,
        message: 'Special case window is not open (10 AM – 5 PM only)',
      });
    }

    // 3. User must have an active special case
    const pollResponse = await PollResponse.findOne({
      where: { poll_id: pollId, user_id: req.actingUserId },
    });
    if (!pollResponse) {
      return error(res, {
        statusCode: 404,
        message: 'You have not voted on this poll',
      });
    }
    if (!pollResponse.is_special_case) {
      return error(res, {
        statusCode: 409,
        message: 'You do not have an active special case to undo',
      });
    }

    // 4. Cannot undo after the super admin has already reviewed it
    if (pollResponse.sehri_allowed !== null) {
      return error(res, {
        statusCode: 409,
        message: 'Your special case has already been reviewed and cannot be undone',
      });
    }

    // 5. Clear the special case fields, keep the original vote intact
    await pollResponse.update({
      is_special_case: false,
      special_case_type: null,
      special_case_at: null,
    });

    return success(res, {
      statusCode: 200,
      message: 'Special case undone',
      data: {
        response_id: pollResponse.id,
        original_response: pollResponse.response,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/special-cases
// Access: super_admin
//
// Returns today's special case submissions so the super admin can review
// them before the 5–6 PM allotment window.
// sehri_allowed is included so the UI can distinguish pending vs reviewed.
// ---------------------------------------------------------------------------
const getSpecialCases = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();

    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll scheduled for today',
        data: { poll: null, cases: [] },
      });
    }

    const cases = await PollResponse.findAll({
      where: { poll_id: poll.id, is_special_case: true },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone'],
        },
      ],
      attributes: [
        'id',
        'response',
        'zone',
        'special_case_type',
        'special_case_at',
        'sehri_allowed',
      ],
      order: [['special_case_at', 'ASC']],
    });

    const shaped = cases.map((c) => ({
      ...c.get({ plain: true }),
      user: describeMember(c.user, ['id', 'name', 'phone']),
    }));

    // Split into pending and already reviewed for convenience
    const pending  = shaped.filter((c) => c.sehri_allowed === null);
    const reviewed = shaped.filter((c) => c.sehri_allowed !== null);

    return success(res, {
      statusCode: 200,
      message: 'Special cases fetched',
      data: {
        poll: { id: poll.id, date: poll.date, phase: getPollPhase(poll) },
        total: shaped.length,
        pending_count: pending.length,
        reviewed_count: reviewed.length,
        cases: shaped,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/polls/special-cases/allot
// Access: super_admin
// Window: ALLOTMENT only (5 PM – 6 PM IST)
//
// Bulk-approves or bulk-rejects special cases.
// Body: { decisions: [{ response_id: 'uuid', decision: 'approved' | 'rejected' }] }
//
// Each item is processed independently — a bad response_id skips that entry
// (reported in the summary) without rolling back the others.
// ---------------------------------------------------------------------------
const allotSpecialCases = async (req, res, next) => {
  try {
    const { decisions } = req.body;

    // 1. Load today's poll and check the allotment window
    const poll = await getTodaysPoll();
    if (!poll) {
      return error(res, { statusCode: 404, message: 'No poll found for today' });
    }

    if (!isAllotmentWindowOpen(poll)) {
      return error(res, {
        statusCode: 403,
        message: 'Allotment window is not open (5 PM – 6 PM only)',
      });
    }

    // 2. Process decisions
    let approved = 0;
    let rejected = 0;
    const skipped = []; // response_ids that weren't found or weren't special cases

    for (const { response_id, decision } of decisions) {
      const pr = await PollResponse.findOne({
        where: {
          id: response_id,
          poll_id: poll.id,      // must belong to today's poll
          is_special_case: true, // must be an actual special case row
        },
      });

      if (!pr) {
        skipped.push(response_id);
        continue;
      }

      await pr.update({ sehri_allowed: decision });

      if (decision === 'approved') approved++;
      else rejected++;
    }

    return success(res, {
      statusCode: 200,
      message: 'Allotment complete',
      data: {
        approved,
        rejected,
        skipped_count: skipped.length,
        skipped_ids: skipped,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/polls/active/toggle
// Access: super_admin
// Body: { is_active: true | false }
//
// Manually opens or closes today's voting window. This is the ONLY place
// that writes to polls.is_active (outside of the cron job).
// deadline_time is set as an audit timestamp so we know when the toggle
// happened, but getPollPhase() does not read it — only is_active matters.
// ---------------------------------------------------------------------------
const togglePoll = async (req, res, next) => {
  try {
    const { is_active } = req.body;

    const poll = await getTodaysPoll();
    if (!poll) {
      return error(res, {
        statusCode: 404,
        message: 'No poll found for today',
      });
    }

    await poll.update({
      is_active,
      deadline_time: getNow(), // audit timestamp only
    });

    return success(res, {
      statusCode: 200,
      message: `Poll voting ${is_active ? 'opened' : 'closed'}`,
      data: {
        id: poll.id,
        date: poll.date,
        is_active: poll.is_active,
        deadline_time: poll.deadline_time,
        phase: getPollPhase(poll),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/history
// Access: admin, super_admin
// Query: ?page=1&limit=20
//
// Returns past polls (dates strictly before today in IST) with vote counts,
// newest first. Each poll includes total yes/no/total across all zones.
// ---------------------------------------------------------------------------
const getPollHistory = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // Today's IST date string — we exclude it so only past polls appear.
    const istTodayStr = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata',
    });

    const { sequelize } = db;

    // Fetch polls before today, paginated
    const { count, rows: polls } = await Poll.findAndCountAll({
      where: { date: { [Op.lt]: istTodayStr } },
      order: [['date', 'DESC']],
      limit,
      offset,
    });

    if (polls.length === 0) {
      return success(res, {
        statusCode: 200,
        message: 'No poll history found',
        data: { total: 0, page, limit, polls: [] },
      });
    }

    // Fetch yes-count aggregations for all fetched polls in one query
    // rather than N queries — more efficient for larger history pages.
    const pollIds = polls.map((p) => p.id);

    // Zone scope for admin — same rule as getActiveStats/getDateStats.
    // A zone admin viewing history should see their zone's turnout, not
    // the community-wide total (which could be much higher and misleading).
    const { zoneName: adminZoneName, error: zoneErr } = await resolveAdminZoneName(req);
    if (zoneErr) return error(res, { statusCode: zoneErr.status, message: zoneErr.message });

    const countWhere = {
      poll_id: { [Op.in]: pollIds },
      ...(adminZoneName ? { zone: adminZoneName } : {}),
    };

    const responseCounts = await PollResponse.findAll({
      where: countWhere,
      attributes: [
        'poll_id',
        'response',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['poll_id', 'response'],
      raw: true,
    });

    // Index counts by poll_id → { yes: n, no: n }
    const countMap = {};
    for (const row of responseCounts) {
      if (!countMap[row.poll_id]) countMap[row.poll_id] = { yes: 0, no: 0 };
      countMap[row.poll_id][row.response] = parseInt(row.count, 10);
    }

    const result = polls.map((poll) => {
      const counts = countMap[poll.id] || { yes: 0, no: 0 };
      return {
        id: poll.id,
        date: poll.date,
        question: poll.question,
        total_yes: counts.yes,
        total_no: counts.no,
        total_votes: counts.yes + counts.no,
      };
    });

    return success(res, {
      statusCode: 200,
      message: 'Poll history fetched',
      data: {
        total: count,
        page,
        limit,
        polls: result,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/date/:date/stats
// Access: admin, super_admin
// Param: date — YYYY-MM-DD
//
// Returns the same zone-by-zone breakdown as GET /active/stats but for any
// historical date. Date format is validated before hitting the DB.
// ---------------------------------------------------------------------------
const getDateStats = async (req, res, next) => {
  try {
    const { date } = req.params;

    // Validate YYYY-MM-DD format strictly — rejects things like "2026-13-01"
    // or plain strings that would silently return 0 counts.
    const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    if (!dateRegex.test(date)) {
      return error(res, {
        statusCode: 400,
        message: 'date param must be in YYYY-MM-DD format',
      });
    }

    const poll = await Poll.findOne({ where: { date } });
    if (!poll) {
      return error(res, {
        statusCode: 404,
        message: `No poll found for date ${date}`,
      });
    }

    // Zone scope for admin — parallel to getActiveStats. Without this a
    // zone admin who reaches the historical /date/:date/stats endpoint
    // would see every zone's totals, contradicting the same-zone-only
    // invariant enforced on the live stats.
    const { zoneName: adminZoneName, error: zoneErr } = await resolveAdminZoneName(req);
    if (zoneErr) return error(res, { statusCode: zoneErr.status, message: zoneErr.message });

    const { by_zone, grand_total } = await buildZoneStats(poll.id, adminZoneName);

    return success(res, {
      statusCode: 200,
      message: `Stats for ${date}`,
      data: {
        poll: {
          id: poll.id,
          date: poll.date,
          question: poll.question,
        },
        by_zone,
        grand_total,
        my_zone: adminZoneName,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitSpecialCase,
  undoSpecialCase,
  getSpecialCases,
  allotSpecialCases,
  togglePoll,
  getPollHistory,
  getDateStats,
};
