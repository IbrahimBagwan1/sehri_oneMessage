'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const { success, error } = require('../utils/response');
const { resolveZone } = require('../utils/resolveZone');
const logger = require('../utils/logger');
const { VALID_ZONES } = require('../constants/zones');
const {
  getPollPhase,
  isVotingOpen,
  PHASES,
} = require('../utils/pollPhase');

const { Poll, PollResponse, User } = db;

// ---------------------------------------------------------------------------
// Shared helper — fetch today's poll record.
// "Today" means the IST calendar date. We query by the `date` column which
// stores a DATEONLY value representing the Sehri date being voted for.
// The poll for tonight's Sehri opens at 10 PM the previous calendar night,
// so `date` is always tomorrow's date from the perspective of someone voting
// after 10 PM. The cron job that creates polls must set `date` to the Sehri
// date (tomorrow), not the creation date (today). This controller does not
// create polls — it only reads the one the cron produced.
// ---------------------------------------------------------------------------
const getTodaysPoll = async () => {
  // Get today's date string in IST (YYYY-MM-DD).
  const istDateStr = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  }); // en-CA locale gives YYYY-MM-DD format natively

  return Poll.findOne({ where: { date: istDateStr } });
};

// ---------------------------------------------------------------------------
// GET /api/polls/active
// Access: any authenticated user, admin, super_admin
//
// Returns today's poll plus the current phase so the mobile client knows
// which UI state to render without doing its own time math.
// ---------------------------------------------------------------------------
const getActivePoll = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();

    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll scheduled for today',
        data: { poll: null, phase: PHASES.CLOSED },
      });
    }

    const phase = getPollPhase(poll);

    // If the calling user is a regular user (or an admin/super_admin acting
    // as a user via requireUserAccess), also attach their own response for
    // today so the home screen can show "You voted: Yes" without a
    // separate request.
    let myResponse = null;
    if (req.actingUserId) {
      myResponse = await PollResponse.findOne({
        where: { poll_id: poll.id, user_id: req.actingUserId },
        attributes: ['response', 'is_special_case', 'special_case_type', 'sehri_allowed'],
      });
    } else if (req.auth.role === 'user') {
      // Fallback: route hit without requireUserAccess (e.g. admin viewing)
      myResponse = null;
    }

    return success(res, {
      statusCode: 200,
      message: 'Active poll fetched',
      data: {
        poll: {
          id: poll.id,
          date: poll.date,
          question: poll.question,
          is_active: poll.is_active,
        },
        phase,
        my_response: myResponse,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// POST /api/polls/:id/respond
// Body: { response: 'yes' | 'no' }
// Access: approved users only
//
// Rules:
// • Voting window must be open (10 PM – 10 AM IST).
// • A user may vote only once per poll — duplicate returns 409.
// • Zone is snapshotted from the user's current location_id at vote time.
// ---------------------------------------------------------------------------
const submitVote = async (req, res, next) => {
  try {
    const { id: pollId } = req.params;
    const { response: vote } = req.body;

    // 1. Load the poll
    const poll = await Poll.findByPk(pollId);
    if (!poll) {
      return error(res, { statusCode: 404, message: 'Poll not found' });
    }

    // 2. Check the voting window
    if (!isVotingOpen(poll)) {
      return error(res, {
        statusCode: 403,
        message: 'Voting window is not open',
      });
    }

    // 3. Prevent duplicate votes
    const existing = await PollResponse.findOne({
      where: { poll_id: pollId, user_id: req.actingUserId },
    });
    if (existing) {
      return error(res, {
        statusCode: 409,
        message: 'You have already voted on this poll',
      });
    }

    // 4. Resolve the user's zone from their location_id.
    //    Zone is stored as a snapshot so kitchen counts remain accurate
    //    even if the user changes zone later.
    const user = await User.findByPk(req.actingUserId, {
      attributes: ['location_id'],
    });
    if (!user) {
      return error(res, { statusCode: 404, message: 'User not found' });
    }

    const zoneLocation = await resolveZone(user.location_id, db);
    if (!zoneLocation) {
      return error(res, {
        statusCode: 422,
        message: 'Could not resolve your zone from your registered location',
      });
    }

    // The zone ENUM in poll_responses matches the Location name column for
    // zone-type rows: 'masjid', 'boys_hostel', 'stanza', 'girls'.
    // resolveZone returns the Location row; we use its name lowercased as key.
    const zoneName = zoneLocation.name.toLowerCase().replace(/\s+/g, '_');
    if (!VALID_ZONES.includes(zoneName)) {
      return error(res, {
        statusCode: 422,
        message: `Zone '${zoneName}' is not a recognised delivery zone`,
      });
    }

    // 5. Create the response
    const pollResponse = await PollResponse.create({
      poll_id: pollId,
      user_id: req.actingUserId,
      response: vote,
      zone: zoneName,
    });

    return success(res, {
      statusCode: 201,
      message: 'Vote submitted successfully',
      data: {
        id: pollResponse.id,
        response: pollResponse.response,
        zone: pollResponse.zone,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/my-responses
// Access: authenticated users
//
// Returns the calling user's full vote history across all polls, newest first.
// Useful for the "Poll History" screen.
// ---------------------------------------------------------------------------
const getMyResponses = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { count, rows } = await PollResponse.findAndCountAll({
      where: { user_id: req.actingUserId },
      include: [
        {
          model: Poll,
          as: 'poll',
          attributes: ['id', 'date', 'question'],
        },
      ],
      attributes: [
        'id',
        'response',
        'zone',
        'is_special_case',
        'special_case_type',
        'sehri_allowed',
        'created_at',
      ],
      order: [[{ model: Poll, as: 'poll' }, 'date', 'DESC']],
      limit,
      offset,
    });

    return success(res, {
      statusCode: 200,
      message: 'Vote history fetched',
      data: {
        total: count,
        page,
        limit,
        responses: rows,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/active/stats
// Access: admin, super_admin
//
// Returns a zone-by-zone breakdown of today's votes.
// Used by the admin dashboard to know how many meals to prepare per zone.
// ---------------------------------------------------------------------------
const getActiveStats = async (req, res, next) => {
  try {
    const poll = await getTodaysPoll();

    if (!poll) {
      return success(res, {
        statusCode: 200,
        message: 'No poll scheduled for today',
        data: { poll: null, stats: null },
      });
    }

    // Aggregate yes/no counts per zone in one query using GROUP BY.
    // sequelize.fn + sequelize.col lets us do COUNT(*) without raw SQL.
    const { sequelize } = db;

    const rows = await PollResponse.findAll({
      where: { poll_id: poll.id },
      attributes: [
        'zone',
        'response',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['zone', 'response'],
      raw: true,
    });

    // Shape the raw rows into a clean zone-keyed map:
    // { masjid: { yes: 5, no: 2, total: 7 }, boys_hostel: { ... }, ... }
    const stats = Object.fromEntries(
      VALID_ZONES.map((z) => [z, { yes: 0, no: 0, total: 0 }])
    );

    for (const row of rows) {
      if (stats[row.zone]) {
        stats[row.zone][row.response] = parseInt(row.count, 10);
      }
    }

    // Compute totals per zone
    for (const zone of VALID_ZONES) {
      stats[zone].total = stats[zone].yes + stats[zone].no;
    }

    // Grand totals across all zones
    const grandTotal = {
      yes: VALID_ZONES.reduce((s, z) => s + stats[z].yes, 0),
      no: VALID_ZONES.reduce((s, z) => s + stats[z].no, 0),
      total: VALID_ZONES.reduce((s, z) => s + stats[z].total, 0),
    };

    return success(res, {
      statusCode: 200,
      message: 'Poll stats fetched',
      data: {
        poll: { id: poll.id, date: poll.date },
        phase: getPollPhase(poll),
        by_zone: stats,
        grand_total: grandTotal,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /api/polls/:id/zone-voters
// Query param: ?zone=masjid  (optional — defaults to the calling admin's zone)
// Access: admin, super_admin
//
// Returns the names of users who voted 'yes' in a specific zone for a given
// poll. Admins see only their own zone unless they are super_admin.
// ---------------------------------------------------------------------------
const getZoneVoters = async (req, res, next) => {
  try {
    const { id: pollId } = req.params;

    // Determine which zone to query.
    // - super_admin may pass ?zone=<name> or omits it to get all zones.
    // - admin is restricted to their own zone (resolved from zone_location_id
    //   on their token, then resolved to a zone name via resolveZone).
    let targetZone = req.query.zone || null;

    if (req.auth.role === 'admin') {
      // Admin's token carries zone_location_id — resolve it to a zone name.
      const adminZoneLocation = await resolveZone(req.auth.zone_location_id, db);
      if (!adminZoneLocation) {
        return error(res, {
          statusCode: 422,
          message: 'Could not resolve your admin zone',
        });
      }
      const adminZoneName = adminZoneLocation.name.toLowerCase().replace(/\s+/g, '_');

      // If the admin tried to pass a different zone, reject it.
      if (targetZone && targetZone !== adminZoneName) {
        return error(res, {
          statusCode: 403,
          message: 'You can only view voters in your own zone',
        });
      }
      targetZone = adminZoneName;
    }

    // Validate zone value if provided
    if (targetZone && !VALID_ZONES.includes(targetZone)) {
      return error(res, {
        statusCode: 400,
        message: `Invalid zone '${targetZone}'. Must be one of: ${VALID_ZONES.join(', ')}`,
      });
    }

    const poll = await Poll.findByPk(pollId);
    if (!poll) {
      return error(res, { statusCode: 404, message: 'Poll not found' });
    }

    // Build the where clause
    const where = {
      poll_id: pollId,
      response: 'yes',
    };
    if (targetZone) {
      where.zone = targetZone;
    }

    const responses = await PollResponse.findAll({
      where,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone'],
        },
      ],
      attributes: ['id', 'zone', 'is_special_case', 'sehri_allowed'],
      order: [['zone', 'ASC']],
    });

    // Group by zone for cleaner consumption by the admin UI
    const grouped = {};
    for (const r of responses) {
      const z = r.zone;
      if (!grouped[z]) grouped[z] = [];
      grouped[z].push({
        response_id: r.id,
        is_special_case: r.is_special_case,
        sehri_allowed: r.sehri_allowed,
        user: r.user,
      });
    }

    return success(res, {
      statusCode: 200,
      message: 'Zone voters fetched',
      data: {
        poll: { id: poll.id, date: poll.date },
        zone: targetZone || 'all',
        voters: grouped,
        total_yes: responses.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTodaysPoll, // exported so Person 2 handlers can import it
  getActivePoll,
  submitVote,
  getMyResponses,
  getActiveStats,
  getZoneVoters,
};
